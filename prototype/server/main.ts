import {randomBytes} from 'node:crypto';
import {mkdirSync,existsSync,readFileSync,writeFileSync,chmodSync} from 'node:fs';
import {resolve} from 'node:path';
import {requireDemoEnvironment,type SourceKey} from '../security/core.js';
import {Store} from './store.js';
import {createApp} from './app.js';

process.umask(0o077);
if(process.env.NODE_ENV==='production'||(process.env.DEMO_MODE&&process.env.DEMO_MODE!=='true'))throw new Error('synthetic_demo_only');
const runtime=resolve('.runtime');mkdirSync(runtime,{recursive:true,mode:0o700});chmodSync(runtime,0o700);
const secretNames=['DEMO_MIS_HMAC_KEY','DEMO_SEDO_HMAC_KEY','DEMO_VLK_HMAC_KEY','DEMO_FINANCE_HMAC_KEY','DEMO_AUDIT_HMAC_KEY','DEMO_SERVICE_HMAC_KEY','DEMO_CIVIL_HMAC_KEY'];
const env:NodeJS.ProcessEnv={...process.env,DEMO_MODE:'true'};
if(secretNames.every(n=>!env[n])){
  const file=resolve(runtime,'local.env');
  if(!existsSync(file))writeFileSync(file,secretNames.map(n=>n+'='+randomBytes(32).toString('hex')).join('\n')+'\n',{mode:0o600,flag:'wx'});
  const saved=readFileSync(file,'utf8');
  const missing=secretNames.filter(name=>!saved.split('\n').some(line=>line.startsWith(name+'=')));
  if(missing.length)writeFileSync(file,saved+missing.map(n=>n+'='+randomBytes(32).toString('hex')).join('\n')+'\n',{mode:0o600});
  chmodSync(file,0o600);
  for(const line of readFileSync(file,'utf8').trim().split('\n')){const [name,value]=line.split('=');if(name&&secretNames.includes(name)&&value)env[name]=value;}
}
const secrets=requireDemoEnvironment(env,['DEMO_SERVICE_HMAC_KEY','DEMO_CIVIL_HMAC_KEY']);
const sourceMap=[['DEMO_MIS_HMAC_KEY','demo-mis'],['DEMO_SEDO_HMAC_KEY','demo-sedo'],['DEMO_VLK_HMAC_KEY','demo-vlk'],['DEMO_FINANCE_HMAC_KEY','demo-finance'],['DEMO_SERVICE_HMAC_KEY','demo-service'],['DEMO_CIVIL_HMAC_KEY','demo-civil-mis']] as const;
const keys=new Map<string,SourceKey>();
const types=new Set(['medical.primary_recorded','care.admitted','care.transferred','care.discharged','care.start_confirmed','document.prepared','document.sent','document.issued','document.corrected','document.withdrawn','document.received','referral.issued','vlk.package_received','vlk.package_returned','vlk.decision_recorded','finance.package_received','finance.status_recorded','service.action_confirmed','source.sync_gap']);
for(const [name,source]of sourceMap)keys.set(source,{id:source,secret:secrets.get(name)!,source,types,subjects:new Set(Array.from({length:30},(_,i)=>'demo-person-'+String(i+1).padStart(2,'0')))});
const port=Number(process.env.DEMO_PORT??4317);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('invalid_demo_port');
const store=new Store(process.env.DEMO_DB_PATH??resolve(runtime,'demo.sqlite'),secrets.get('DEMO_AUDIT_HMAC_KEY')!);
const server=createApp({store,keys,origin:`http://127.0.0.1:${port}`});
store.refreshDeadlines(Date.now());store.dispatchLocalOutbox();
const worker=setInterval(()=>{try{store.refreshDeadlines(Date.now());store.dispatchLocalOutbox();}catch{/* Наступний bounded batch повторить локальне повідомлення. */}},1000);worker.unref();
server.listen(port,'127.0.0.1',()=>{process.stdout.write(`Навчальний прототип: http://127.0.0.1:${port}\nЛише вигадані дані. Фаза 8б — синтетичний маршрут.\n`);});
const close=()=>{clearInterval(worker);server.close(()=>{store.close();process.exit(0);});};
process.on('SIGTERM',close);process.on('SIGINT',close);
