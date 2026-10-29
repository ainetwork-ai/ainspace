import { storageClient } from './storage-client';
import type { PlayerPresence } from './storage';
import { villageHuddleInstance } from './village-huddle-instance';
/** Only the authenticated SSE stream may acquire, renew or release its connection ID. */
export async function joinVillageConnection(village: string, userId: string, connectionId: string, instanceId: string, player: Omit<PlayerPresence, 'userId'>) {
  if (!await storageClient.presenceJoin(village, instanceId, userId, connectionId, player)) throw Error('Village connection unavailable');
}
export async function renewVillageConnection(village: string, userId: string, connectionId: string, instanceId: string) {
  if (!await storageClient.presenceRenew(village, instanceId, userId, connectionId)) throw Error('Village connection expired');
}
export async function releaseVillageConnection(village: string, userId: string, connectionId: string, instanceId: string) {
  return storageClient.presenceRelease(village, instanceId, userId, connectionId);
}
export async function hasVillageConnection(village: string, userId: string) {
  const instance = await villageHuddleInstance(village);
  return instance ? storageClient.presenceHas(village, instance.instanceId, userId) : false;
}
/** Anonymous world visitors cannot become authenticated Huddle mention recipients. */
export async function listLiveVillageConnections(village: string) {
  const instance = await villageHuddleInstance(village);
  if (!instance) return [];
  return (await storageClient.presenceList(village, instance.instanceId)).map(row => row.userId)
    .filter(id => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id));
}
