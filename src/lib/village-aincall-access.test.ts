import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeVillageAinCall, VillageAinCallDenied } from './village-aincall-access';

test('members can join; visitors need a live connection in the exact village', async () => {
  const directory = { villageExists: async (slug: string) => slug === 'owned-village', isMember: async (_: string, userId: string) => userId === 'member' };
  const connected = async (slug: string, userId: string) => slug === 'owned-village' && userId === 'visitor';
  assert.equal((await authorizeVillageAinCall('owned-village', 'member', directory, async () => { throw new Error('should not check presence'); })).access, 'member');
  assert.equal((await authorizeVillageAinCall('owned-village', 'visitor', directory, connected)).access, 'present');
  await assert.rejects(authorizeVillageAinCall('other-village', 'visitor', directory, connected), VillageAinCallDenied);
  await assert.rejects(authorizeVillageAinCall('owned-village', 'departed', directory, connected), VillageAinCallDenied);
});

test('guest identities, deleted villages and stale connections cannot authorize AinCalls', async () => {
  const directory = { villageExists: async () => true, isMember: async () => false };
  await assert.rejects(authorizeVillageAinCall('owned-village', 'guest:member', directory, async () => true), VillageAinCallDenied);
  await assert.rejects(authorizeVillageAinCall('owned-village', 'account', { ...directory, villageExists: async () => false }, async () => true), VillageAinCallDenied);
  await assert.rejects(authorizeVillageAinCall('owned-village', 'account', directory, async () => false), VillageAinCallDenied);
  await assert.rejects(authorizeVillageAinCall('../owned-village', 'account', directory, async () => true), VillageAinCallDenied);
});
