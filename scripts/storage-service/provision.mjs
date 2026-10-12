import fs from 'node:fs';
import {AinTransport} from './dist/ain-transport.js';
import {stateHeadWriteRule,stateChunksWriteRule} from './dist/ain-state-store.js';
(async()=>{
 const source=JSON.parse(fs.readFileSync('/home/comcom/.ainize-web/uncommon-orchestrator/blockchain-state.json','utf8'));
 const config={...source,application:'uncommon_gallery_ainspace'};
 const chain=new AinTransport(config);await chain.verifyNetwork();
 const metadata=await chain.get('/apps/'+config.application+'/state_metadata');
 if(metadata && metadata.organizationId!==config.organizationId)throw Error('Existing app belongs to another organization');
 const admin=await chain.get('/manage_app/'+config.application+'/config/admin');
 const ops=[];
 if(!admin)ops.push({type:'SET_VALUE',ref:'/manage_app/'+config.application+'/create/'+Date.now(),value:{admin:{[chain.address]:true}}});
 else if(!admin[chain.address])throw Error('Existing app has another owner');
 if(!metadata){
  ops.push({type:'SET_VALUE',ref:'/apps/'+config.application+'/state_metadata',value:{organizationId:config.organizationId,purpose:'ainspace-state',version:1}});
  const root='/apps/'+config.application+'/state';
  ops.push({type:'SET_RULE',ref:root,value:{'.rule':{write:false}}});
  ops.push({type:'SET_RULE',ref:root+'/heads/$recordId',value:{'.rule':{write:stateHeadWriteRule(chain.address)}}});
  ops.push({type:'SET_RULE',ref:root+'/chunks/$recordId/$revision/$index',value:{'.rule':{write:stateChunksWriteRule(chain.address)}}});
 }
 if(ops.length)await chain.write(ops);
 const dir='/home/comcom/.ainize-web/ainspace-storage';fs.mkdirSync(dir,{recursive:true,mode:0o700});
 fs.writeFileSync(dir+'/config.json',JSON.stringify(config),{mode:0o600});
 console.log(JSON.stringify({application:config.application,organizationId:config.organizationId,created:!metadata,operations:ops.length}));
})().catch(()=>{console.error('Ainspace state provisioning failed');process.exit(1)});
