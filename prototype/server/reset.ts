import {existsSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
export function resetOwnedDatabase(path:string):void {
  if(process.env.NODE_ENV==='production'||(process.env.DEMO_MODE&&process.env.DEMO_MODE!=='true'))throw new Error('synthetic_demo_only');
  if(!['.runtime/demo.sqlite','.runtime/e2e.sqlite'].map(p=>resolve(p)).includes(resolve(path)))throw new Error('reset_accepts_owned_demo_only');
  if(existsSync(path)){
    const db=new DatabaseSync(path,{readOnly:true});
    try{if(!db.prepare("SELECT id FROM seed_snapshot WHERE id='demo-cohort-v1' AND definition_version='seed-1'").get())throw new Error('foreign_database_refused');}finally{db.close();}
    for(const suffix of ['','-wal','-shm'])rmSync(path+suffix,{force:true});
  }
}
if(fileURLToPath(import.meta.url)===resolve(process.argv[1]??'')){
  if(process.env.DEMO_DB_PATH)throw new Error('reset_accepts_default_demo_only');
  resetOwnedDatabase(resolve('.runtime/demo.sqlite'));
  process.stdout.write('Локальний синтетичний seed буде відновлено на наступному запуску.\n');
}
