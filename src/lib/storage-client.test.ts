
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storageClient, StorageSubscriber } from './storage-client';

function configure(t:import('node:test').TestContext) {
  for(const [key,value] of Object.entries({AINSPACE_STORAGE_URL:'https://storage.example/api/storage',AINSPACE_STORAGE_TOKEN:'fixture-token'})) {
    const old=process.env[key];process.env[key]=value;
    t.after(()=>{if(old===undefined)delete process.env[key];else process.env[key]=old;});
  }
}
test('storage calls use the authenticated gateway and preserve selected-key ordering',async t=>{
  configure(t);
  t.mock.method(globalThis,'fetch',async(url:unknown,options:RequestInit)=>{
    assert.equal(url,'https://storage.example/api/storage/command');
    assert.equal((options.headers as Record<string,string>).Authorization,'Bearer fixture-token');
    assert.equal(options.redirect,'error');
    assert.deepEqual(JSON.parse(options.body as string),{operation:'mGet',keys:['agents:b','agents:a']});
    return Response.json({result:['second','first']});
  });
  assert.deepEqual(await storageClient.mGet(['agents:b','agents:a']),['second','first']);
});
test('missing or failing storage never becomes an in-memory success',async t=>{
  configure(t);
  t.mock.method(globalThis,'fetch',async()=>new Response('private failure',{status:503}));
  await assert.rejects(storageClient.set('auth:user','role'),/^Error: Storage gateway operation failed \(503\)$/);
  delete process.env.AINSPACE_STORAGE_TOKEN;
  await assert.rejects(storageClient.get('auth:user'),/not configured/);
});
test('one shared channel fans out events and disconnect requests a new snapshot',async t=>{
  configure(t);
  let controller:ReadableStreamDefaultController<Uint8Array>;
  let connections=0;
  t.mock.method(globalThis,'fetch',async(_url:unknown,options:RequestInit)=>{
    connections++;
    const stream=new ReadableStream<Uint8Array>({start(value){controller=value;}});
    options.signal?.addEventListener('abort',()=>{try{controller.close();}catch{}},{once:true});
    return new Response(stream,{headers:{'Content-Type':'text/event-stream'}});
  });
  const subscriber=new StorageSubscriber();
  const first:string[]=[],second:string[]=[];
  const a=(message:string)=>first.push(message),b=(message:string)=>second.push(message);
  await subscriber.subscribe('village:test:events',a);
  await subscriber.subscribe('village:test:events',b);
  assert.equal(connections,1);
  controller!.enqueue(new TextEncoder().encode('data: '+JSON.stringify('hello')+'\n\n'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(first,['hello']);assert.deepEqual(second,['hello']);
  await subscriber.unsubscribe('village:test:events',a);
  controller!.close();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(first.length,1);
  assert.equal(JSON.parse(second[1]).type,'STORAGE_CONNECTION_LOST');
  await subscriber.unsubscribe('village:test:events',b);
});
