import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import { AinStateStore } from "./ain-state-store";
import { EncryptedStateCodec } from "./encrypted-state";
import { AinWriteRejected, ChainOperation, StateChainTransport } from "./ain-transport";

class TestChain implements StateChainTransport {
  values = new Map<string, unknown>();
  rejectChunks = false;
  unconfirmed = false;
  async get<T>(ref: string): Promise<T | null> {
    if (ref.endsWith("/heads")) return Object.fromEntries([...this.values].filter(([key]) => key.startsWith(ref + "/")).map(([key, value]) => [key.slice(ref.length + 1), value])) as T;
    return this.values.has(ref) ? structuredClone(this.values.get(ref)) as T : null;
  }
  async write(operations: ChainOperation[]): Promise<void> {
    for (const op of operations) {
      if (op.ref.includes("/heads/")) {
        const before = this.values.get(op.ref) as { revision: string } | undefined;
        const after = op.value as { previousRevision: string | null };
        if (after.previousRevision !== (before?.revision ?? null)) throw new AinWriteRejected("CAS rejected");
      } else if (this.rejectChunks) throw Error("Chunk confirmation failed");
      this.values.set(op.ref, structuredClone(op.value));
    }
    if (this.unconfirmed) throw Error("Finality timed out");
  }
}
const root = "/apps/uncommon_gallery_orchestrator/state";
function setup() {
  const chain = new TestChain(), codec = new EncryptedStateCodec("org-uncommon", randomBytes(32));
  let now = 1000;
  return { chain, codec, store: new AinStateStore(chain, codec, root, () => now), advance: (ms: number) => { now += ms; } };
}
test("string, set, batch read, keys and deletion preserve the existing state contract", async () => {
  const { store } = setup();
  assert.equal(await store.get("thread:id"), null);
  assert.equal(await store.set("thread:id", "한글🙂"), "OK");
  assert.equal(await store.sAdd("threads:list", ["id", "id", "second"]), 2);
  assert.equal(await store.sRem("threads:list", ["second", "missing"]), 1);
  assert.deepEqual(await store.sMembers("threads:list"), ["id"]);
  assert.deepEqual(await store.mGet(["missing", "thread:id"]), [null, "한글🙂"]);
  assert.deepEqual(await store.keys("thread:*"), ["thread:id"]);
  assert.equal(await store.del(["thread:id", "missing"]), 1);
  assert.equal(await store.exists("thread:id"), 0);
  assert.equal(await store.sCard("threads:list"), 1);
  await store.quit();
});
test("expiry survives a new process; normal SET clears previous expiry", async () => {
  const { chain, codec, store, advance } = setup();
  await store.setEx("cache:a", 1, "temporary");
  advance(1000);
  assert.equal(await store.get("cache:a"), null);
  await store.setEx("cache:b", 1, "temporary");
  await store.set("cache:b", "durable");
  advance(1000);
  assert.equal(await store.get("cache:b"), "durable");
  const restored = new AinStateStore(chain, codec, root, () => 3000);
  assert.equal(await restored.get("cache:a"), null);
  assert.equal(await restored.get("cache:b"), "durable");
});
test("competing processes cannot lose set members or resurrect a deleted revision", async () => {
  const { chain, codec, store } = setup();
  const second = new AinStateStore(chain, codec, root);
  await Promise.all([store.sAdd("agents", "first"), second.sAdd("agents", "second")]);
  assert.deepEqual((await store.sMembers("agents")).sort(), ["first", "second"]);
  await store.del("agents");
  await second.sAdd("agents", "new");
  assert.deepEqual(await store.sMembers("agents"), ["new"]);
});
test("a failed chunk write leaves the last committed value readable", async () => {
  const { chain, store } = setup();
  await store.set("messages:id", "original");
  chain.rejectChunks = true;
  await assert.rejects(store.set("messages:id", "new"), /confirmation/);
  assert.equal(await store.get("messages:id"), "original");
});
test("unconfirmed finality is surfaced and cannot be changed into success by readback", async () => {
  const { chain, store } = setup();
  await store.set("messages:id", "original");
  chain.unconfirmed = true;
  await assert.rejects(store.set("messages:id", "new"), /Finality timed out/);
});
test("missing committed chunks and wrong value types fail closed", async () => {
  const { chain, codec, store } = setup();
  await store.sAdd("set", "a");
  await assert.rejects(store.get("set"), /WRONGTYPE/);
  await store.set("value", "a");
  await assert.rejects(store.sAdd("value", "a"), /WRONGTYPE/);
  for (const key of chain.values.keys()) if (key.includes("/chunks/")) chain.values.delete(key);
  const restored = new AinStateStore(chain, codec, root);
  await assert.rejects(restored.get("value"), /missing a chunk/);
});
test("cache pipeline propagates failures", async () => {
  const { chain, store } = setup();
  const pipeline = store.multi().setEx("cache:a", 5, "a").setEx("cache:b", 5, "b");
  assert.deepEqual(await pipeline.exec(), ["OK", "OK"]);
  chain.rejectChunks = true;
  await assert.rejects(store.multi().setEx("cache:c", 5, "c").exec());
});

test("hashes retain concurrent fields, reject wrong types, and survive restart", async () => {
  const { chain, codec, store } = setup();
  const second = new AinStateStore(chain, codec, root, () => 1000);
  await Promise.all([store.hSet("auth:user", "owner", "yes"), second.hSet("auth:user", { permissions: "read" })]);
  assert.deepEqual(await store.hGetAll("auth:user"), { owner: "yes", permissions: "read" });
  assert.equal(await store.hLen("auth:user"), 2);
  assert.equal(await store.hGet("auth:user", "missing"), null);
  assert.equal(await second.hSet("auth:user", "owner", "changed"), 0);
  assert.equal(await store.hDel("auth:user", ["owner", "missing"]), 1);
  assert.deepEqual(await new AinStateStore(chain, codec, root).hGetAll("auth:user"), { permissions: "read" });
  await assert.rejects(store.get("auth:user"), /WRONGTYPE/);
});
test("OAuth state can only be consumed once across concurrent service replicas", async () => {
  const { chain, codec, store } = setup();
  const second = new AinStateStore(chain, codec, root, () => 1000);
  await store.set("oauth:state", "single-use");
  const results = await Promise.all([store.getDel("oauth:state"), second.getDel("oauth:state")]);
  assert.deepEqual(results.sort(), ["single-use", null].sort());
  assert.equal(await store.get("oauth:state"), null);
});
test("hash TTL is preserved by updates and expires after restart", async () => {
  const { chain, codec, store, advance } = setup();
  await store.hSet("task:short", "status", "running");
  assert.equal(await store.expire("task:short", 1), 1);
  await store.hSet("task:short", "progress", "50");
  advance(1000);
  assert.deepEqual(await store.hGetAll("task:short"), {});
  assert.deepEqual(await new AinStateStore(chain, codec, root, () => 2000).hGetAll("task:short"), {});
  assert.equal(await store.expire("missing", 1), 0);
});

import { storageServer, execute } from "./server";
import { AddressInfo } from "node:net";

test("gateway requires authentication and never exposes raw storage failures", async t => {
  const { store }=setup();
  const server=storageServer(store,"a".repeat(64));
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const base="http://127.0.0.1:"+(server.address() as AddressInfo).port;
  const denied=await fetch(base+"/command",{method:"POST",body:JSON.stringify({operation:"get",key:"private"})});
  assert.equal(denied.status,401);
  const forbidden=await fetch(base+"/command",{method:"POST",headers:{Authorization:"Bearer "+"a".repeat(64)},body:JSON.stringify({operation:"arbitraryAdminCommand",key:"private"})});
  assert.equal(forbidden.status,503);
  assert.deepEqual(await forbidden.json(),{error:"storage_operation_failed"});
  assert.equal(await store.exists("ainspace:private"),0);
});
test("gateway namespaces all commands and scans without touching reports", async () => {
  const {chain,codec}=setup();
  const store=new AinStateStore(chain,codec,root,()=>1000,"ainspace");
  const reports=new AinStateStore(chain,codec,root,()=>1000);
  await reports.set("report:original","original");
  await execute(store,{operation:"set",key:"agents:test",value:"agent"});
  assert.deepEqual(await execute(store,{operation:"scan",key:"*"}),["agents:test"]);
  assert.equal(await reports.get("report:original"),"original");
  assert.equal(await store.get("ainspace:agents:test"),"agent");
});
test("presence updates are transient and subscriptions deliver cross-client events", async t => {
  const {store,chain}=setup();
  const server=storageServer(store,"b".repeat(64));
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const base="http://127.0.0.1:"+(server.address() as AddressInfo).port;
  const headers={Authorization:"Bearer "+"b".repeat(64)};
  const send=async(value:unknown)=>(await fetch(base+"/command",{method:"POST",headers,body:JSON.stringify(value)})).json() as Promise<{result:unknown}>;
  assert.deepEqual(await send({operation:"hSet",key:"village:test:players",field:"alice",value:"presence"}),{result:1});
  assert.deepEqual(await send({operation:"hGetAll",key:"village:test:players"}),{result:{alice:"presence"}});
  assert.equal(chain.values.size,0);
  const abort=new AbortController();
  const response=await fetch(base+"/events?channel=village:test:events",{headers,signal:abort.signal});
  const reader=response.body!.getReader();
  await reader.read();
  await send({operation:"publish",key:"village:test:events",value:JSON.stringify({userId:"alice"})});
  const event=await reader.read();
  assert.match(new TextDecoder().decode(event.value),/alice/);
  abort.abort();await reader.cancel().catch(()=>{});
});


test("atomic import batches preserve all records, skip identical replay and surface finality failures", async () => {
  const {store,chain}=setup();
  const records:import("./encrypted-state").StateValue[]=[
    {key:"auth:a",type:"hash",value:{permissions:"read"},expiresAt:null},
    {key:"agent:b",type:"string",value:"card",expiresAt:null},
  ];
  assert.equal(await store.putBatch(records),2);
  assert.deepEqual(await store.hGetAll("auth:a"),{permissions:"read"});
  assert.equal(await store.get("agent:b"),"card");
  assert.equal(await store.putBatch(records),0);
  chain.unconfirmed=true;
  await assert.rejects(store.putBatch([{key:"new:c",type:"string",value:"value",expiresAt:null}]),/Finality timed out/);
});
test("an oversized multi-record import fails before publishing any value", async () => {
  const {store,chain}=setup();
  const records:import("./encrypted-state").StateValue[]=Array.from({length:30},(_,index)=>({key:"record:"+index,type:"string",value:"value",expiresAt:null}));
  await assert.rejects(store.putBatch(records),/batch exceeds/);
  assert.equal(chain.values.size,0);
});
