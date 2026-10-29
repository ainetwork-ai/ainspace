import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeVillageHuddle, VillageHuddleDenied } from './village-huddle-access';

test('members can join; visitors need a live connection in the exact village', async () => {
  const directory = { villageExists: async (slug: string) => slug === 'owned-village', isMember: async (_: string, userId: string) => userId === 'member' };
  const connected = async (slug: string, userId: string) => slug === 'owned-village' && userId === 'visitor';
  assert.equal((await authorizeVillageHuddle('owned-village', 'member', directory, async () => { throw new Error('should not check presence'); })).access, 'member');
  assert.equal((await authorizeVillageHuddle('owned-village', 'visitor', directory, connected)).access, 'present');
  await assert.rejects(authorizeVillageHuddle('other-village', 'visitor', directory, connected), VillageHuddleDenied);
  await assert.rejects(authorizeVillageHuddle('owned-village', 'departed', directory, connected), VillageHuddleDenied);
});

test('guest identities, deleted villages and stale connections cannot authorize Huddles', async () => {
  const directory = { villageExists: async () => true, isMember: async () => false };
  await assert.rejects(authorizeVillageHuddle('owned-village', 'guest:member', directory, async () => true), VillageHuddleDenied);
  await assert.rejects(authorizeVillageHuddle('owned-village', 'account', { ...directory, villageExists: async () => false }, async () => true), VillageHuddleDenied);
  await assert.rejects(authorizeVillageHuddle('owned-village', 'account', directory, async () => false), VillageHuddleDenied);
  await assert.rejects(authorizeVillageHuddle('../owned-village', 'account', directory, async () => true), VillageHuddleDenied);
});
