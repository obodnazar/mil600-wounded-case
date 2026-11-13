import {randomBytes} from 'node:crypto';
import {Store} from './store.js';
import {createApp} from './app.js';
import {fixtures} from './fixtures.js';
import type {SourceKey} from '../security/core.js';
// Окремий тестовий процес із memory SQLite; підвищені ліміти лише для швидкого E2E.
const store=new Store(':memory:',randomBytes(32)),keys=new Map<string,SourceKey>();
for(const source of new Set(fixtures.map(f=>f.event.source_system)))keys.set(source,{id:source,source,secret:randomBytes(32),types:new Set(fixtures.map(f=>f.event.event_type)),subjects:new Set(Array.from({length:30},(_,i)=>'demo-person-'+String(i+1).padStart(2,'0')))});
const server=createApp({store,keys,origin:'http://127.0.0.1:4318',readLimit:10000,ingressLimit:10000});
server.listen(4318,'127.0.0.1');
const close=()=>server.close(()=>{store.close();process.exit(0);});process.on('SIGTERM',close);process.on('SIGINT',close);
