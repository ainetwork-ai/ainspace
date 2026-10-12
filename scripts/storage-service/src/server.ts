import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { createAinStateStore } from "./config";
import { AinStateStore } from "./ain-state-store";

export interface Command { operation: string; key?: string; keys?: string[]; value?: string; field?: string; fields?: string[] | Record<string,string>; members?: string | string[]; seconds?: number }
const PREFIX="ainspace:";
const MAX_BODY=8*1024*1024;
function privateFile(path:string) {
  const stat=statSync(path);
  if(!stat.isFile() || (stat.mode&0o077) || (process.getuid && stat.uid!==process.getuid())) throw Error("Storage credentials must be private and service-owned");
  return readFileSync(path,"utf8").trim();
}
function sameSecret(received:string,expected:string) {
  const a=Buffer.from(received),b=Buffer.from(expected);
  return a.length===b.length && timingSafeEqual(a,b);
}
function key(value:unknown) {
  if(typeof value!=="string" || !value || value.length>8192 || value.includes("\0")) throw Error("Invalid storage key");
  return PREFIX+value;
}
function list(value:unknown):string[] {
  if(!Array.isArray(value) || value.length>1000 || value.some(v=>typeof v!=="string")) throw Error("Invalid storage list");
  return value;
}
export async function execute(store:AinStateStore,command:Command):Promise<unknown> {
  const k=command.key===undefined ? "" : key(command.key);
  switch(command.operation) {
    case "get": return store.get(k);
    case "mGet": return store.mGet(list(command.keys).map(key));
    case "set":
      if(typeof command.value!=="string") throw Error("Invalid storage value");
      return command.seconds===undefined ? store.set(k,command.value) : store.setEx(k,command.seconds,command.value);
    case "type": return store.type(k);
    case "exists": return store.exists(k);
    case "sIsMember": if(typeof command.members!=="string") throw Error("Invalid member"); return (await store.sMembers(k)).includes(command.members);
    case "getDel": return store.getDel(k);
    case "del": return store.del(command.keys ? list(command.keys).map(key) : k);
    case "expire": return store.expire(k,command.seconds!);
    case "hGet": if(typeof command.field!=="string") throw Error("Invalid hash field"); return store.hGet(k,command.field);
    case "hGetAll": return store.hGetAll(k);
    case "hLen": return store.hLen(k);
    case "hSet":
      if(typeof command.field==="string" && typeof command.value==="string") return store.hSet(k,command.field,command.value);
      if(!command.fields || Array.isArray(command.fields) || typeof command.fields!=="object" || Object.values(command.fields).some(v=>typeof v!=="string")) throw Error("Invalid hash fields");
      return store.hSet(k,command.fields);
    case "hDel": return store.hDel(k,typeof command.field==="string" ? command.field : list(command.fields));
    case "sAdd": return store.sAdd(k,typeof command.members==="string" ? command.members : list(command.members));
    case "sRem": return store.sRem(k,typeof command.members==="string" ? command.members : list(command.members));
    case "sMembers": return store.sMembers(k);
    case "scan": return (await store.keys(k)).map(v=>v.slice(PREFIX.length));
    default: throw Error("Unsupported storage operation");
  }
}
type EphemeralValue={ fields:Record<string,string>; expiresAt:number };
/** Presence has no durable authority; central TTL state replaces distributed Redis pubsub. */
class PresenceStore {
  values=new Map<string,EphemeralValue>();
  async command(command:Command):Promise<unknown> {
    const k=key(command.key),now=Date.now();
    const current=this.values.get(k);
    if(current && current.expiresAt<=now) this.values.delete(k);
    const value=this.values.get(k);
    switch(command.operation) {
      case "hGetAll": return {...value?.fields};
      case "hGet": return value && Object.hasOwn(value.fields,command.field!) ? value.fields[command.field!] : null;
      case "hLen": return Object.keys(value?.fields ?? {}).length;
      case "hSet": {
        const fields=typeof command.field==="string" ? {[command.field]:command.value!} : command.fields;
        if(!fields || Array.isArray(fields) || Object.values(fields).some(v=>typeof v!=="string")) throw Error("Invalid presence fields");
        const next=value ?? {fields:Object.create(null),expiresAt:now+3600000};
        let added=0;
        for(const [f,v] of Object.entries(fields)) { if(!Object.hasOwn(next.fields,f)) added++; next.fields[f]=v; }
        this.values.set(k,next); return added;
      }
      case "hDel": {
        let removed=0;
        for(const f of typeof command.field==="string" ? [command.field] : list(command.fields)) {
          if(value && Object.hasOwn(value.fields,f)) { delete value.fields[f]; removed++; }
        }
        if(value && !Object.keys(value.fields).length) this.values.delete(k);
        return removed;
      }
      case "expire": if(!Number.isSafeInteger(command.seconds)) throw Error("Invalid expiry"); if(!value) return 0;
        value.expiresAt=now+command.seconds!*1000; return 1;
      case "del": return this.values.delete(k) ? 1 : 0;
      default: throw Error("Unsupported presence command");
    }
  }
}
function respond(response:ServerResponse,status:number,value:unknown) {
  response.writeHead(status,{"Content-Type":"application/json","Cache-Control":"no-store"});
  response.end(JSON.stringify(value));
}
async function body(request:IncomingMessage):Promise<Command> {
  let size=0; const chunks:Buffer[]=[];
  for await(const chunk of request) { size+=chunk.length; if(size>MAX_BODY) throw Error("Request too large"); chunks.push(chunk); }
  const parsed=JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if(!parsed || typeof parsed!=="object" || Array.isArray(parsed)) throw Error("Invalid command");
  return parsed;
}
export function storageServer(store:AinStateStore,secret:string) {
  if(secret.length<32) throw Error("Gateway token must have at least 32 characters");
  let pending=0;
  const presence=new PresenceStore();
  const listeners=new Map<string,Set<ServerResponse>>();
  const sweep=setInterval(()=>{for(const [k,v] of presence.values) if(v.expiresAt<=Date.now()) presence.values.delete(k);},60000);
  sweep.unref();
  const server=createServer(async(request,response)=>{
    if(!sameSecret(request.headers.authorization ?? "","Bearer "+secret)) return respond(response,401,{error:"unauthorized"});
    const url=new URL(request.url ?? "/","http://storage");
    if(url.pathname==="/health" && request.method==="GET") return respond(response,200,{ok:true,storage:"ain-blockchain",subscriptions:[...listeners.values()].reduce((sum,v)=>sum+v.size,0)});
    if(url.pathname==="/events" && request.method==="GET") {
      const channel=url.searchParams.get("channel") ?? "";
      if(!/^village:.{1,512}:events$/.test(channel)) return respond(response,400,{error:"invalid_channel"});
      const group=listeners.get(channel) ?? new Set<ServerResponse>();
      if(group.size>=500) return respond(response,503,{error:"busy"});
      listeners.set(channel,group); group.add(response);
      response.writeHead(200,{"Content-Type":"text/event-stream","Cache-Control":"no-cache, no-transform","X-Accel-Buffering":"no"});
      response.write(": connected\n\n");
      const heartbeat=setInterval(()=>response.write(": ping\n\n"),15000);
      response.on("close",()=>{clearInterval(heartbeat);group.delete(response);if(!group.size) listeners.delete(channel);});
      return;
    }
    if(url.pathname!=="/command" || request.method!=="POST") return respond(response,404,{error:"not_found"});
    if(pending>=256) return respond(response,503,{error:"busy"});
    pending++;
    try {
      const command=await body(request);
      let result:unknown;
      if(command.operation==="publish") {
        if(typeof command.key!=="string" || !/^village:.{1,512}:events$/.test(command.key) || typeof command.value!=="string" || command.value.length>65536) throw Error("Invalid event");
        const group=listeners.get(command.key);
        for(const target of group ?? []) {
          // Slow consumers reconnect and obtain a fresh snapshot, never grow an unbounded queue.
          if(target.writableLength>262144) target.destroy();
          else target.write("data: "+JSON.stringify(command.value)+"\n\n");
        }
        result=group?.size ?? 0;
      } else if(command.operation==="del" && command.keys) {
        const keys=list(command.keys),durable:string[]=[];
        let removed=0;
        for(const name of keys) {
          if(/^village:.*:(players|heartbeat|ain_presence)$/.test(name)) removed+=Number(await presence.command({operation:"del",key:name}));
          else durable.push(name);
        }
        if(durable.length) removed+=Number(await execute(store,{operation:"del",keys:durable}));
        result=removed;
      } else if(command.key && /^village:.*:(players|heartbeat|ain_presence)$/.test(command.key)) result=await presence.command(command);
      else result=await execute(store,command);
      respond(response,200,{result});
    } catch { respond(response,503,{error:"storage_operation_failed"}); }
    finally { pending--; }
  });
  server.on("close",()=>{clearInterval(sweep);for(const group of listeners.values()) for(const response of group) response.destroy();});
  return server;
}
if(require.main===module) {
  const token=privateFile(process.env.AINSPACE_STORAGE_TOKEN_FILE ?? "");
  createAinStateStore(process.env.AIN_STATE_CONFIG ?? "").then(store=>{
    const server=storageServer(store,token);
    server.requestTimeout=30000;
    server.listen(Number(process.env.PORT ?? 13006),"127.0.0.1");
    process.on("SIGTERM",()=>{server.close();server.closeAllConnections();store.quit().then(()=>process.exit(0));});
  }).catch(()=>{console.error("Storage gateway initialization failed");process.exit(1);});
}
