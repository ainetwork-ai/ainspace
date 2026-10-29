import assert from "node:assert/strict";
import { test } from "node:test";
import { AinTransport } from "./ain-transport";

function transport() {
  return new AinTransport({rpcUrl:"http://127.0.0.1:19077/json-rpc",chainId:1,genesisHash:"0x"+"0".repeat(64),privateKey:"0".repeat(63)+"1",gasPrice:0,transactionBytesLimit:100000});
}
test("transient layer failures retry reads but never replay writes",async t=>{
  let calls=0;
  t.mock.method(globalThis,"fetch",async()=>{
    calls++;
    return Response.json(calls===1?{error:{code:-32050,message:"Selected layer upstream unavailable"}}:{result:{result:"value"}});
  });
  assert.equal(await transport().rpc("ain_get",{ref:"/apps/example"}),"value");
  assert.equal(calls,2);
  calls=0;
  await assert.rejects(transport().rpc("ain_sendSignedTransaction"),/code -32050/);
  assert.equal(calls,1);
});
test("a layer that is not ready yet (-32052 or HTTP 503) is retried for reads only",async t=>{
  let calls=0;
  t.mock.method(globalThis,"fetch",async()=>{
    calls++;
    if(calls===1) return new Response("not ready",{status:503});
    return Response.json(calls===2?{error:{code:-32052,message:"Selected layer is not ready"}}:{result:{result:"value"}});
  });
  assert.equal(await transport().rpc("ain_get",{ref:"/apps/example"}),"value");
  assert.equal(calls,3);
  calls=0;
  await assert.rejects(transport().rpc("ain_sendSignedTransaction"),/HTTP 503/);
  assert.equal(calls,1);
});
test("RPC requests are bounded to eight in flight",async t=>{
  let active=0,maximum=0;
  t.mock.method(globalThis,"fetch",async()=>{
    active++;maximum=Math.max(maximum,active);
    await new Promise(resolve=>setTimeout(resolve,5));
    active--;
    return Response.json({result:{result:"value"}});
  });
  const chain=transport();
  await Promise.all(Array.from({length:25},()=>chain.rpc("ain_get")));
  assert.equal(maximum,8);
});
test("finalized pagination retains all labels and rejects a repeated page",async t=>{
  let page=0;
  t.mock.method(globalThis,"fetch",async(_url:unknown,options:RequestInit)=>{
    const body=JSON.parse(options.body as string);
    assert.equal(body.params.is_final,true);
    assert.equal(body.params.is_partial,true);
    page++;
    return Response.json({result:{result:page===1?{a:{},"#end_label":"next"}:{b:{}}}});
  });
  assert.deepEqual(await transport().childLabels("/apps/example/state/heads"),["a","b"]);
  page=0;
  t.mock.method(globalThis,"fetch",async()=>Response.json({result:{result:{a:{},"#end_label":"same"}}}));
  await assert.rejects(transport().childLabels("/apps/example/state/heads"),/repeated a record/);
});
