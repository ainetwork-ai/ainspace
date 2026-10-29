export interface ConnectionPlayer { x: number; y: number; direction: string; displayName: string; spriteKey: string }
interface StorageCommand {
  village?: string; instanceId?: string; userId?: string; connectionId?: string; player?: ConnectionPlayer;
  operation: string; key?: string; keys?: string[]; value?: string;
  field?: string; fields?: string[] | Record<string,string>; members?: string | string[]; seconds?: number; onlyIfAbsent?: boolean;
}
function configuration(): {base:string; token:string} {
  const endpoint=process.env.AINSPACE_STORAGE_URL;
  const token=process.env.AINSPACE_STORAGE_TOKEN;
  if(!endpoint || !token) throw Error('AINspace storage gateway is not configured');
  const url=new URL(endpoint);
  if((url.protocol!=='https:' && !(url.protocol==='http:' && ['127.0.0.1','localhost'].includes(url.hostname))) || url.username || url.password || url.search || url.hash) throw Error('Invalid storage gateway URL');
  return {base:endpoint.replace(/\/$/,''),token};
}
async function command<T>(payload:StorageCommand):Promise<T> {
  const {base,token}=configuration();
  const response=await fetch(base+'/command',{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
    body:JSON.stringify(payload),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(45000),
  });
  if(!response.ok) throw Error('Storage gateway operation failed ('+response.status+')');
  const value=await response.json();
  if(!value || !Object.hasOwn(value,'result')) throw Error('Invalid storage gateway response');
  return value.result as T;
}
export const storageClient={
  villageInstance:(village:string)=>command<{instanceId:string;title:string}|null>({operation:'village.instance',village}),
  presenceJoin:(village:string,instanceId:string,userId:string,connectionId:string,player:ConnectionPlayer)=>command<boolean>({operation:'presence.join',village,instanceId,userId,connectionId,player}),
  presenceRenew:(village:string,instanceId:string,userId:string,connectionId:string,player?:ConnectionPlayer)=>command<boolean>({operation:'presence.renew',village,instanceId,userId,connectionId,player}),
  presenceRelease:(village:string,instanceId:string,userId:string,connectionId:string)=>command<boolean>({operation:'presence.release',village,instanceId,userId,connectionId}),
  presenceList:(village:string,instanceId:string)=>command<Array<ConnectionPlayer & {userId:string}>>({operation:'presence.list',village,instanceId}),
  presenceHas:(village:string,instanceId:string,userId:string)=>command<boolean>({operation:'presence.has',village,instanceId,userId}),

  async connect():Promise<void> {
    const {base,token}=configuration();
    const response=await fetch(base+'/health',{headers:{Authorization:'Bearer '+token},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!response.ok) throw Error('Storage gateway unavailable');
  },
  async close():Promise<void> {},
  keys:(pattern:string)=>command<string[]>({operation:'scan',key:pattern}),
  async scan(_cursor:number|string,options:{MATCH?:string;COUNT?:number}={}):Promise<{cursor:number;keys:string[]}> {
    return {cursor:0,keys:await command<string[]>({operation:'scan',key:options.MATCH??'*'})};
  },
  type:(key:string)=>command<string>({operation:'type',key}),
  get:(key:string)=>command<string|null>({operation:'get',key}),
  mGet:(keys:string[])=>command<(string|null)[]>({operation:'mGet',keys}),
  set:(key:string,value:string,options?:{EX?:number})=>command<string>({operation:'set',key,value,seconds:options?.EX}),
  claimOnce:(key:string,seconds:number)=>command<'OK'|null>({operation:'set',key,value:'1',seconds,onlyIfAbsent:true}),
  getDel:(key:string)=>command<string|null>({operation:'getDel',key}),
  del:(keys:string|string[])=>command<number>(typeof keys==='string'?{operation:'del',key:keys}:{operation:'del',keys}),
  expire:(key:string,seconds:number)=>command<number>({operation:'expire',key,seconds}),
  hGet:(key:string,field:string)=>command<string|null>({operation:'hGet',key,field}),
  hGetAll:(key:string)=>command<Record<string,string>>({operation:'hGetAll',key}),
  hLen:(key:string)=>command<number>({operation:'hLen',key}),
  hSet:(key:string,field:string|Record<string,string>,value?:string)=>command<number>(typeof field==='string'?{operation:'hSet',key,field,value}:{operation:'hSet',key,fields:field}),
  hDel:(key:string,fields:string|string[])=>command<number>(typeof fields==='string'?{operation:'hDel',key,field:fields}:{operation:'hDel',key,fields}),
  sAdd:(key:string,members:string|string[])=>command<number>({operation:'sAdd',key,members}),
  exists:(key:string)=>command<number>({operation:'exists',key}),
  sIsMember:(key:string,member:string)=>command<boolean>({operation:'sIsMember',key,members:member}),
  sMembers:(key:string)=>command<string[]>({operation:'sMembers',key}),
  sRem:(key:string,members:string|string[])=>command<number>({operation:'sRem',key,members}),
  publish:(key:string,value:string)=>command<number>({operation:'publish',key,value}),
  async *scanIterator(options:{MATCH?:string; COUNT?:number}={}):AsyncGenerator<string[]> {
    const keys=await command<string[]>({operation:'scan',key:options.MATCH??'*'});
    for(let offset=0;offset<keys.length;offset+=500) yield keys.slice(offset,offset+500);
  },
};
type Listener=(message:string)=>void;
interface Subscription { listeners:Set<Listener>; abort:AbortController; ready:Promise<void> }
export class StorageSubscriber {
  private channels=new Map<string,Subscription>();
  async subscribe(channel:string,listener:Listener):Promise<void> {
    const existing=this.channels.get(channel);
    if(existing) { existing.listeners.add(listener); return existing.ready; }
    const subscription:Subscription={listeners:new Set([listener]),abort:new AbortController(),ready:Promise.resolve()};
    this.channels.set(channel,subscription);
    subscription.ready=this.start(channel,subscription);
    try { await subscription.ready; } catch(error) { this.channels.delete(channel);subscription.abort.abort();throw error; }
  }
  private async start(channel:string,subscription:Subscription):Promise<void> {
    const response=await this.connect(channel,subscription);
    void this.consume(channel,subscription,response);
  }
  private async connect(channel:string,subscription:Subscription) {
    const {base,token}=configuration();
    const response=await fetch(base+'/events?channel='+encodeURIComponent(channel),{
      headers:{Authorization:'Bearer '+token},cache:'no-store',redirect:'error',
      signal:AbortSignal.any([subscription.abort.signal,AbortSignal.timeout(290000)]),
    });
    if(!response.ok || !response.body) throw Error('Storage subscription unavailable');
    return response;
  }
  private async consume(channel:string,subscription:Subscription,response:Response) {
    const reader=response.body!.getReader();
    const decoder=new TextDecoder();let buffer='';
    try {
      while(!subscription.abort.signal.aborted) {
        const {value,done}=await reader.read();if(done) break;
        buffer+=decoder.decode(value,{stream:true});
        let end:number;
        while((end=buffer.indexOf('\n\n'))>=0) {
          const event=buffer.slice(0,end);buffer=buffer.slice(end+2);
          const data=event.split('\n').find(line=>line.startsWith('data: '));
          if(data) {
            const message:unknown=JSON.parse(data.slice(6));
            if(typeof message==='string') for(const listener of subscription.listeners) listener(message);
          }
        }
        if(buffer.length>262144) throw Error('Storage event exceeds buffer limit');
      }
    } catch { /* Every client reconnects and takes a new snapshot below. */ }
    finally {
      await reader.cancel().catch(()=>{});reader.releaseLock();
      if(!subscription.abort.signal.aborted) {
        for(const listener of [...subscription.listeners]) listener(JSON.stringify({type:'STORAGE_CONNECTION_LOST'}));
        subscription.abort.abort();this.channels.delete(channel);
      }
    }
  }
  async unsubscribe(channel:string,listener:Listener):Promise<void> {
    const subscription=this.channels.get(channel);if(!subscription) return;
    subscription.listeners.delete(listener);
    if(!subscription.listeners.size) { subscription.abort.abort();this.channels.delete(channel); }
  }
}


export type StorageClient = typeof storageClient;
