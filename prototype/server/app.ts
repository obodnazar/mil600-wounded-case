import {createServer, type IncomingMessage} from 'node:http';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Denied,Ingress,Limiter,checkSession,checkCase,headers,signature,type SourceKey,type Session,type SignatureHeaders,type EventEnvelope,type AuditAction} from '../security/core.js';
import {readJsonBody,requestHeader,validateEvent} from '../security/protocol.js';
import type {DemoProfile,SessionView} from '../shared/view.js';
import {Store,hash} from './store.js';

export const profiles:DemoProfile[]=['patient','commander','support','analyst','dev'];
const actors:Record<DemoProfile,string>={patient:'demo-person-01',commander:'demo-commander',support:'demo-support',analyst:'demo-analyst',dev:'demo-dev'};
export function primaryFixture():EventEnvelope {return {schema_version:'case-event/1',event_id:'demo-ui-primary-v1',event_type:'medical.primary_recorded',source_system:'demo-mis',
  source_record_ref:'demo-ui-primary-record',source_stream:'demo-ui-primary-stream',source_version:'v1',source_order:null,subject_ref:'demo-person-01',incident_ref:'demo-incident-01',episode_ref:null,
  occurred_at:'2026-11-13T10:00:00.000Z',recorded_at:'2026-11-13T10:05:00.000Z',payload:{document_kind:'primary_medical_card',document_version:'v1'}};}
export interface AppOptions {store:Store;keys:Map<string,SourceKey>;origin:string;now?:()=>number;readLimit?:number;ingressLimit?:number}
export function createApp(options:AppOptions){
  if(process.env.NODE_ENV==='production'||!/^http:\/\/127\.0\.0\.1:[0-9]{1,5}$/.test(options.origin))throw new Error('loopback_demo_only');
  for(const [keyId,key] of options.keys)if(keyId!==key.id||key.secret.length<32||key.secret.equals(options.store.auditKey))throw new Error('invalid_key_configuration');
  if(new Set([...options.keys.values()].map(k=>k.secret.toString('hex'))).size!==options.keys.size)throw new Error('separate_keys_required');
  const {store}=options, now=options.now??Date.now, reads=new Limiter(options.readLimit??60,60000), writes=new Limiter(options.ingressLimit??30,60000);
  const ingress=new Ingress(options.keys,e=>Boolean(validateEvent(e)));
  const gateway=(raw:Buffer,h:SignatureHeaders)=>store.accept(ingress.authenticate(raw,h,now()),h,now());
  const sessionToken=(req:IncomingMessage)=>/^(?:.*;\s*)?demo_session=([a-f0-9]{64})(?:;.*)?$/.exec(requestHeader(req,'cookie'))?.[1];
  const getSession=(req:IncomingMessage)=>{
    const token=sessionToken(req);const s=token?store.row('SELECT * FROM demo_session WHERE token_hash=? AND expires_at>?',hash(token),now()):undefined;
    if(!s)throw new Denied(401,'authentication_required');return s;
  };
  const authorized=(req:IncomingMessage):Session=>{
    const s=getSession(req);if(!s.profile||!s.actor_id)throw new Denied(401,'authentication_required');
    return checkSession({...store.session(s.profile as DemoProfile,String(s.actor_id),now()),expiresAt:Number(s.expires_at)},now());
  };
  const server=createServer(async(req,res)=>{
    for(const [key,value] of Object.entries(headers))res.setHeader(key,value);
    let action:AuditAction='case_read', actor='anonymous', resource='unknown', role='anonymous';
    const reply=(status:number,data:unknown)=>{res.writeHead(status);res.end(JSON.stringify(data));};
    const issueSession=(profile:DemoProfile|null,oldToken:string|undefined):SessionView=>{
      const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex'),expires=now()+900000;
      store.run('DELETE FROM demo_session WHERE expires_at<=?',now());
      if(Number(store.row('SELECT COUNT(*) AS n FROM demo_session')?.n??0)>=1000)throw new Denied(429,'session_capacity');
      if(oldToken)store.run('DELETE FROM demo_session WHERE token_hash=?',hash(oldToken));
      if(profile)store.session(profile,actors[profile],now());
      store.run('INSERT INTO demo_session VALUES (?,?,?,?,?,?)',hash(token),profile?actors[profile]:null,profile,hash(csrf),csrf,expires);
      res.setHeader('Set-Cookie',`demo_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=900`);
      return {profile,csrf,expiresAt:expires,profiles};
    };
    try {
      const path=new URL(req.url??'/',options.origin);
      resource=path.pathname.startsWith('/api/cases/')?path.pathname.split('/')[3]??'unknown':path.pathname;
      action=path.pathname.includes('clinical-document')?'clinical_read':path.pathname==='/api/analytics'?'analytics_read':path.pathname==='/api/integration/events'?'event_validate':path.pathname==='/api/session'?'session_read':path.pathname==='/api/demo/session'?'session_change':path.pathname==='/api/demo/primary'?'simulator_run':'case_read';
      if(requestHeader(req,'host')!==new URL(options.origin).host||!['127.0.0.1','::ffff:127.0.0.1','::1'].includes(req.socket.remoteAddress??''))throw new Denied(403,'loopback_required');
      if(path.search)throw new Denied(400,'query_not_supported');
      const origin=requestHeader(req,'origin'),site=requestHeader(req,'sec-fetch-site');
      if((origin&&origin!==options.origin)||site==='cross-site')throw new Denied(403,'origin_denied');
      const peer=req.socket.remoteAddress??'unknown';
      if(path.pathname==='/api/integration/events'){
        writes.take(peer,now());if(req.method!=='POST')throw new Denied(405,'method_not_allowed');
        const result=gateway(await readJsonBody(req),{keyId:requestHeader(req,'x-key-id'),timestamp:requestHeader(req,'x-timestamp'),nonce:requestHeader(req,'x-nonce'),signature:requestHeader(req,'x-signature')});
        reply(result.http,{status:result.status,business_applied:result.business_applied});return;
      }
      if(!path.pathname.startsWith('/api/')){
        if(req.method!=='GET')throw new Denied(405,'method_not_allowed');
        const asset=/^\/assets\/[A-Za-z0-9._-]+\.(js|css)$/.exec(path.pathname);
        if(path.pathname!=='/'&&!asset)throw new Denied(404,'not_found');
        const file=readFileSync(resolve('public',asset?path.pathname.slice(1):'index.html'));
        res.setHeader('Content-Type',asset?(asset[1]==='css'?'text/css':'text/javascript')+'; charset=utf-8':'text/html; charset=utf-8');
        res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
        res.writeHead(200);res.end(file);return;
      }
      reads.take(peer,now());
      if(path.pathname==='/api/session'&&req.method==='GET'){
        const token=sessionToken(req),s=token?store.row('SELECT profile,csrf_token,expires_at FROM demo_session WHERE token_hash=? AND expires_at>?',hash(token),now()):undefined;
        const view=store.transaction(()=>{const v=s?{profile:s.profile,csrf:s.csrf_token,expiresAt:s.expires_at,profiles}:issueSession(null,token);store.audit(action,'allowed',actor,resource,now(),role);return v;});
        reply(200,view);return;
      }
      if(req.method==='POST'){
        writes.take(peer,now());if(origin!==options.origin)throw new Denied(403,'origin_required');
        const s=getSession(req),csrf=requestHeader(req,'x-csrf-token');
        if(!/^[a-f0-9]{64}$/.test(csrf)||!timingSafeEqual(Buffer.from(hash(csrf),'hex'),Buffer.from(String(s.csrf_hash),'hex')))throw new Denied(403,'csrf_denied');
        if(path.pathname==='/api/demo/session'){
          const parsed:unknown=JSON.parse((await readJsonBody(req)).toString('utf8'));
          if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||Object.keys(parsed).length!==1||!('profile'in parsed)||(parsed.profile!==null&&!profiles.includes(parsed.profile as DemoProfile)))throw new Denied(400,'invalid_demo_profile');
          const profile=parsed.profile as DemoProfile|null;
          const view=store.transaction(()=>{const v=issueSession(profile,sessionToken(req));store.audit(action,'allowed',profile?actors[profile]:'anonymous',resource,now(),profile??'anonymous');return v;});
          reply(200,view);return;
        }
        const session=authorized(req);actor=session.actorId;role=session.role;
        if(path.pathname==='/api/demo/primary'){
          if(session.role!=='dev')throw new Denied(403,'forbidden');
          if((await readJsonBody(req)).toString('utf8')!=='{}')throw new Denied(400,'fixed_fixture_only');
          const key=[...options.keys.values()].find(k=>k.source==='demo-mis');if(!key)throw new Denied(503,'source_unavailable');
          const raw=Buffer.from(JSON.stringify(primaryFixture())),h={keyId:key.id,timestamp:String(Math.floor(now()/1000)),nonce:randomBytes(16).toString('hex')};
          store.audit(action,'allowed',actor,'fixed-primary-fixture',now(),role);
          const result=gateway(raw,{...h,signature:signature(key.secret,h,raw)});
          reply(result.http,{status:result.status,business_applied:result.business_applied});return;
        }
        throw new Denied(404,'not_found');
      }
      if(req.method!=='GET')throw new Denied(405,'method_not_allowed');
      const session=authorized(req);actor=session.actorId;role=session.role;
      let view:unknown;
      const match=/^\/api\/cases\/(demo-[a-z0-9-]{1,60})(\/clinical-document)?$/.exec(path.pathname);
      if(match){const caseId=match[1]!;checkCase(session,caseId,Boolean(match[2]));view=match[2]?{status:'synthetic_document',sample:'Вигаданий навчальний зразок; медичного змісту немає'}:store.caseView(caseId,session.role==='patient');}
      else if(path.pathname==='/api/patient'){
        if(session.role!=='patient')throw new Denied(403,'forbidden');const caseId=[...session.caseIds][0];if(!caseId)throw new Denied(404,'not_found');checkCase(session,caseId);view=store.caseView(caseId,true);
      }else if(path.pathname==='/api/staff')view=store.staffView(session);
      else if(path.pathname==='/api/analytics'){if(session.role!=='analyst')throw new Denied(403,'forbidden');view=store.analytics();}
      else if(path.pathname==='/api/dev'){if(session.role!=='dev')throw new Denied(403,'forbidden');view=store.devView();}
      else throw new Denied(404,'not_found');
      store.audit(action,'allowed',actor,resource,now(),role);reply(200,view);
    }catch(error){
      const failure=error instanceof Denied?error:error instanceof SyntaxError?new Denied(400,'invalid_json'):new Denied(503,'service_unavailable');
      try{store.audit(action,'denied',actor,resource,now(),role);}catch{reply(503,{error:'audit_unavailable'});return;}
      reply(failure.status,{error:failure.code});
    }
  });
  server.requestTimeout=5000;server.headersTimeout=3000;server.keepAliveTimeout=1000;
  return server;
}
