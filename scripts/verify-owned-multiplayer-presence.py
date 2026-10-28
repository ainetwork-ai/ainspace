"""Run actual presence Lua on the owned Ainize server Redis DB15, isolated keys."""
import json, pathlib, re, shlex, subprocess
source = (pathlib.Path(__file__).resolve().parents[1] / 'src/lib/village-connection-presence.ts').read_text()
scripts = {name: re.search(name + r' = `(.*?)`;', source, re.S).group(1)
           for name in ['RELEASE_VILLAGE_CONNECTION', 'REMOVE_IDLE_VILLAGE_PRESENCE', 'RENEW_VILLAGE_CONNECTION', 'HAS_VILLAGE_CONNECTION', 'JOIN_VILLAGE_CONNECTION']}
verified_source = (pathlib.Path(__file__).resolve().parents[1] / 'src/lib/ain-integration/verified-village-presence.ts').read_text()
scripts.update({name: re.search(name + r' = `(.*?)`;', verified_source, re.S).group(1)
                for name in ['MARK_VERIFIED_VILLAGE_PRESENCE', 'CLEAR_VERIFIED_VILLAGE_PRESENCE']})
remote = '''import socket,json,sys,uuid,time
v=json.load(sys.stdin);s=socket.create_connection(("127.0.0.1",17879),5);f=s.makefile("rb")
def read():
 line=f.readline();t=line[:1];b=line[1:-2]
 if t==b"-":raise RuntimeError(b.decode())
 if t==b"+":return b.decode()
 if t==b":":return int(b)
 if t==b"$":
  n=int(b)
  if n<0:return None
  x=f.read(n);f.read(2);return x.decode()
 if t==b"*":return [read() for _ in range(int(b))]
def cmd(*a):
 a=[str(x).encode() for x in a];s.sendall(b"*"+str(len(a)).encode()+b"\\r\\n"+b"".join(b"$"+str(len(x)).encode()+b"\\r\\n"+x+b"\\r\\n" for x in a));return read()
cmd("SELECT",15);p="owned-ainspace-presence-"+uuid.uuid4().hex;ks=[p+":connections",p+":players",p+":heartbeat",p+":events",p+":source"];now=int(time.time()*1000);verified=[p+":verified-connections",p+":closed",p+":verified-presence"]
def release(c):return cmd("EVAL",v["RELEASE_VILLAGE_CONNECTION"],5,*ks,c,now,"user","{}","original")
def idle():return cmd("EVAL",v["REMOVE_IDLE_VILLAGE_PRESENCE"],5,*ks,now,"user","{}","original")
try:
 cmd("HSET",ks[4],"huddleInstance","original")
 cmd("HSET",ks[1],"user","player","other","unaffected");cmd("HSET",ks[2],"user",now)
 cmd("ZADD",ks[0],now+45000,"old",now+45000,"replacement")
 assert idle()==0 and cmd("HGET",ks[1],"user")=="player"
 assert release("old")==0 and cmd("HGET",ks[1],"user")=="player"
 assert release("old")==0 and idle()==0
 assert release("replacement")==1 and cmd("HGET",ks[1],"user") is None
 assert cmd("HGET",ks[2],"user") is None and cmd("HGET",ks[1],"other")=="unaffected"
 cmd("HSET",ks[1],"user","stale");cmd("HSET",ks[2],"user",now)
 cmd("ZADD",ks[0],now-1,"expired")
 assert idle()==1 and idle()==0
 assert cmd("HGET",ks[1],"other")=="unaffected"
 # Deletion/recreation must invalidate old leases, renewal and departure.
 cmd("HSET",ks[4],"huddleInstance","replacement")
 cmd("HSET",ks[1],"user","new-player")
 cmd("ZADD",ks[0],now+45000,"old-generation")
 assert cmd("EVAL",v["HAS_VILLAGE_CONNECTION"],2,ks[0],ks[4],"original","("+str(now))==0
 assert cmd("EVAL",v["RENEW_VILLAGE_CONNECTION"],3,ks[0],ks[4],ks[2],"original",now+45000,"stale","user",now)==0
 assert release("old-generation")==0 and cmd("HGET",ks[1],"user")=="new-player"
 assert idle()==0 and cmd("HGET",ks[1],"user")=="new-player"
 def join(instance,c):return cmd("EVAL",v["JOIN_VILLAGE_CONNECTION"],5,ks[0],ks[4],ks[2],ks[1],ks[3],instance,now+45000,c,"user",now,"new-player","{}")
 assert join("original","stale-join")==0 and cmd("HGET",ks[1],"user")=="new-player"
 assert cmd("ZSCORE",ks[0],"stale-join") is None
 assert join("replacement","fresh")==1
 assert cmd("EVAL",v["RENEW_VILLAGE_CONNECTION"],3,ks[0],ks[4],ks[2],"replacement",now+45000,"fresh","user",now)==1
 cmd("ZREM",ks[0],"fresh")
 cmd("HDEL",ks[2],"user")
 assert cmd("EVAL",v["RENEW_VILLAGE_CONNECTION"],3,ks[0],ks[4],ks[2],"replacement",now+45000,"fresh","user",now)==0
 assert cmd("HGET",ks[2],"user") is None
 assert join("replacement","new-fresh")==1
 assert cmd("EVAL",v["HAS_VILLAGE_CONNECTION"],2,ks[0],ks[4],"replacement","("+str(now))>0
 print(json.dumps({"recreatedSourceRejectsOldLease":True,"oldRenewalRejected":True,"oldDeparturePreservesNewPlayer":True,"staleJoinCannotOverwritePlayer":True,"closedRenewalCannotRevive":True}))
 def mark(c):return cmd("EVAL",v["MARK_VERIFIED_VILLAGE_PRESENCE"],3,*verified,c,now,now+600000,"user")
 def clear(c):return cmd("EVAL",v["CLEAR_VERIFIED_VILLAGE_PRESENCE"],3,*verified,c,now,now+600000,"user")
 cmd("HSET",verified[2],"other",now)
 assert mark("tab-a")==1 and mark("tab-b")==1
 assert clear("tab-a")==0 and cmd("HGET",verified[2],"user") is not None
 assert mark("tab-a")==0
 assert clear("legacy")==0 and clear("tab-a")==0
 assert clear("tab-b")==1 and cmd("HGET",verified[2],"user") is None
 assert mark("tab-b")==0 and mark("new-visit")==1
 assert cmd("HGET",verified[2],"other")==str(now)
 assert clear("new-visit")==1
 print(json.dumps({"verifiedPresenceConnections":True,"closedConnectionCannotRevive":True,"legacyDisconnectPreservesLiveConnection":True,"freshVisitAccepted":True}))
 print(json.dumps({"actualRemoteRedis":True,"beaconPreservesLiveTabs":True,"oldDisconnectPreservesReplacement":True,"duplicateDisconnectIgnored":True,"lastDisconnectRemovesOwnPresence":True,"expiredConnectionsAllowIdleCleanup":True,"otherPlayerPreserved":True}))
finally:cmd("DEL",*ks,*verified);s.close()
'''
args = ['ssh', '-o', 'ControlMaster=no', '-o', 'BatchMode=yes', '-o', 'ProxyCommand=none',
        '-o', 'ConnectTimeout=8', '-i', '/Users/kmh4500/.ssh/gpu_admin',
        'nvidia@192.168.1.15', 'python3 -c ' + shlex.quote(remote)]
result = subprocess.run(args, input=json.dumps(scripts).encode(), capture_output=True, timeout=30)
if result.returncode:
    raise SystemExit('Owned remote multiplayer Redis verification failed')
print(result.stdout.decode().strip())
