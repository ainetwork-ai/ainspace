import { storageClient } from './storage-client';
/** The gateway initializes a UUID on existing village metadata under native AIN CAS.
 * No frontend read/write race, and deleted villages are never created by this read. */
export async function villageHuddleInstance(slug: string): Promise<{ instanceId: string; title: string } | null> {
  const instance = await storageClient.villageInstance(slug);
  if (instance === null) return null;
  if (!instance || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(instance.instanceId) || typeof instance.title !== 'string' || !instance.title || instance.title.length > 500) {
    throw Error('Village metadata unavailable');
  }
  return instance;
}
