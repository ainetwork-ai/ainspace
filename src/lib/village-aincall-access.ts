import { isVillageSlug } from './ain-integration/village-materials';
import type { VillageDirectory } from './ain-integration/village-membership';

export class VillageAinCallDenied extends Error {
  constructor() { super('Village aincall unavailable'); }
}

/** userId must come from server session verification; guest/avatar query IDs cannot authorize a call. */
export async function authorizeVillageAinCall(
  slug: string,
  userId: string,
  directory: Pick<VillageDirectory, 'villageExists' | 'isMember'>,
  hasLiveConnection: (slug: string, userId: string) => Promise<boolean>,
) {
  if (!isVillageSlug(slug) || !userId || userId.startsWith('guest:') || !(await directory.villageExists(slug))) throw new VillageAinCallDenied();
  if (await directory.isMember(slug, userId)) return { slug, canJoin: true as const, access: 'member' as const };
  if (await hasLiveConnection(slug, userId)) return { slug, canJoin: true as const, access: 'present' as const };
  throw new VillageAinCallDenied();
}
