import { test } from 'node:test';
import assert from 'node:assert/strict';
import { villagePresenceIdentity } from './village-presence-identity';
test('account switching separates presence despite a retained browser guest identity', () => {
  const state = { isBackendAuthed: true, backendUser: { id: 'account-a' }, getUserId: () => 'same-browser-guest' };
  assert.equal(villagePresenceIdentity(state), 'account-a');
  assert.equal(villagePresenceIdentity({ ...state, backendUser: { id: 'account-b' } }), 'account-b');
  assert.equal(villagePresenceIdentity({ ...state, isBackendAuthed: false }), 'guest:same-browser-guest');
  assert.equal(villagePresenceIdentity({ ...state, backendUser: null }), 'guest:same-browser-guest');
});
