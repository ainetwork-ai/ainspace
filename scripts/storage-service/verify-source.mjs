import fs from 'node:fs';import crypto from 'node:crypto';
import {createAinStateStore} from './dist/config.js';
const source=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const store=await createAinStateStore(process.env.AIN_STATE_CONFIG);
const canonical=value=>Array.isArray(value)?JSON.stringify([...value].sort()):value&&typeof value==='object'?JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)))):JSON.stringify(value);
let checked=0;const failures=[];
for(const record of source.entries){
 try{
  const key='ainspace:'+record.key;
  const value=record.type==='string'?await store.get(key):record.type==='hash'?await store.hGetAll(key):await store.sMembers(key);
  if(canonical(value)!==canonical(record.value))failures.push({index:checked,error:'mismatch'});
 }catch(error){failures.push({index:checked,type:record.type,prefix:record.key.split(':')[0],error:error.message});}
 checked++;
 if(checked%100===0)console.log(JSON.stringify({checked,failures:failures.length}));
}
const result={passed:!failures.length,checked,failures,sha256:crypto.createHash('sha256').update(fs.readFileSync(process.argv[2])).digest('hex')};
fs.writeFileSync('/home/comcom/.ainize-web/ainspace-storage/import-verification.json',JSON.stringify(result,null,2),{mode:0o600});
console.log(JSON.stringify(result));await store.quit();if(failures.length)process.exit(1);
