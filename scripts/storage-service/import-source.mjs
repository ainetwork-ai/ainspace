import fs from 'node:fs';
import crypto from 'node:crypto';
import {createAinStateStore} from './dist/config.js';
import {StateBatchTooLarge} from './dist/ain-state-store.js';
(async()=>{
 const snapshot=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
 const store=await createAinStateStore(process.env.AIN_STATE_CONFIG);
 let imported=0,unchanged=0;
 const records=snapshot.entries.filter(record=>!/^village:.*:(players|heartbeat|ain_presence)$/.test(record.key) && (record.expiresAt===null || record.expiresAt>Date.now()))
   .map(record=>({key:'ainspace:'+record.key,type:record.type,value:record.value,expiresAt:record.expiresAt}));
 const write=async batch=>{
  try { const count=await store.putBatch(batch);imported+=count;unchanged+=batch.length-count; }
  catch(error) {
   if(!(error instanceof StateBatchTooLarge) || batch.length<2)throw error;
   const middle=Math.floor(batch.length/2);await write(batch.slice(0,middle));await write(batch.slice(middle));
  }
 };
 for(let offset=0;offset<records.length;offset+=20) {
  await write(records.slice(offset,offset+20));
  console.log(JSON.stringify({completed:imported+unchanged,total:records.length,imported,unchanged}));
 }
 const failures=[];
 for(const record of snapshot.entries){
  if(/^village:.*:(players|heartbeat|ain_presence)$/.test(record.key) || (record.expiresAt!==null && record.expiresAt<=Date.now()))continue;
  let value;
  if(record.type==='string')value=await store.get('ainspace:'+record.key);
  else if(record.type==='hash')value=await store.hGetAll('ainspace:'+record.key);
  else value=await store.sMembers('ainspace:'+record.key);
  const canonical=value=>Array.isArray(value)?JSON.stringify([...value].sort()):value&&typeof value==='object'?JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)))):JSON.stringify(value);
  if(canonical(value)!==canonical(record.value))failures.push(crypto.createHash('sha256').update(record.key).digest('hex'));
 }
 const result={complete:failures.length===0,total:snapshot.entries.length,imported,unchanged,failures,source:process.argv[2],sourceSha256:crypto.createHash('sha256').update(fs.readFileSync(process.argv[2])).digest('hex')};
 fs.writeFileSync('/home/comcom/.ainize-web/ainspace-storage/import-result.json',JSON.stringify(result,null,2),{mode:0o600});
 console.log(JSON.stringify(result));await store.quit();
 if(failures.length)process.exit(1);
})().catch(error=>{console.error('AINspace storage import failed; no fallback used: '+error.message);process.exit(1)});
