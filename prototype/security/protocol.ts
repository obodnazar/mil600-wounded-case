import {createRequire} from 'node:module';
import type {IncomingMessage} from 'node:http';
import type {Ajv as AjvType} from 'ajv';
import schema from './event.schema.json' with {type:'json'};
import {Denied} from './core.js';
const require=createRequire(import.meta.url);
const Ajv=require('ajv') as typeof AjvType;
const addFormats=require('ajv-formats') as (ajv:AjvType)=>void;
const ajv=new Ajv({allErrors:false,strict:true});addFormats(ajv);
export const validateEvent=ajv.compile(schema);
export function requestHeader(req:IncomingMessage,name:string):string {const v=req.headers[name];return typeof v==='string'?v:'';}
export async function readJsonBody(req:IncomingMessage):Promise<Buffer> {
  if(requestHeader(req,'content-type')!=='application/json')throw new Denied(415,'json_required');
  if(req.headers['content-encoding'])throw new Denied(415,'encoding_not_supported');
  const chunks:Buffer[]=[];let size=0;
  for await(const chunk of req){const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk as string);size+=b.length;if(size>16384)throw new Denied(413,'body_too_large');chunks.push(b);}
  return Buffer.concat(chunks);
}
