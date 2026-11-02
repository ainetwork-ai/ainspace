import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { verifyTeamsAinCallProof, TeamsAinCallProofDenied } from './teams-aincall-proof';
const secret = 'owned-test-secret-not-a-deployed-credential';
const issuer = 'https://sso.example'; const now = 1_800_000_000_000;
const principal = { userId: randomUUID(), issuer, subject: 'subject', slug: 'village', instanceId: randomUUID() };
function request(value: unknown = principal, timestamp = String(now), nonce = randomBytes(16).toString('hex'), signingSecret = secret) {
  const body = JSON.stringify(value);
  const signature = createHmac('sha256', signingSecret).update(`ain-space.aincall-authority.v1\n${timestamp}\n${nonce}\n${body}`).digest('hex');
  return new Request('https://space.example/api/teams/aincalls/authorize', { method: 'POST', body,
    headers: { 'X-Ain-Timestamp': timestamp, 'X-Ain-Nonce': nonce, 'X-Ain-Signature': signature } });
}
test('accepts configured issuer and rejects replay through atomic nonce claim', async () => {
  const used = new Set<string>(); const claimNonce = async (nonce: string) => { if (used.has(nonce)) return false; used.add(nonce); return true; };
  const first = request(); const second = first.clone();
  assert.deepEqual(await verifyTeamsAinCallProof(first, { secret, issuer, now, claimNonce }), principal);
  await assert.rejects(verifyTeamsAinCallProof(second, { secret, issuer, now, claimNonce }), TeamsAinCallProofDenied);
});
test('rejects bad signature, stale proof, unknown issuer and browser extra claims before consuming nonce', async () => {
  let claims = 0; const claimNonce = async () => { claims++; return true; };
  for (const candidate of [request(principal, String(now), undefined, 'wrong-secret'), request(principal, String(now - 30_001)),
    request({ ...principal, issuer: 'https://other.example' }), request({ ...principal, role: 'owner' }), request({ ...principal, userId: 'guest:avatar' })]) {
    await assert.rejects(verifyTeamsAinCallProof(candidate, { secret, issuer, now, claimNonce }), TeamsAinCallProofDenied);
  }
  assert.equal(claims, 0);
});
test('fails closed on replay store outage and oversized signed body', async () => {
  await assert.rejects(verifyTeamsAinCallProof(request(), { secret, issuer, now, claimNonce: async () => { throw new Error('Store unavailable'); } }), /Store unavailable/);
  await assert.rejects(verifyTeamsAinCallProof(request({ ...principal, subject: 'a'.repeat(5000) }), { secret, issuer, now, claimNonce: async () => true }), TeamsAinCallProofDenied);
});

test('initial SSO discovery is explicit; ongoing authority still requires the exact Space instance', async () => {
  const identity = { userId: principal.userId, issuer, subject: principal.subject, slug: principal.slug };
  await assert.rejects(verifyTeamsAinCallProof(request(identity), { secret, issuer, now, claimNonce: async () => true }), TeamsAinCallProofDenied);
  assert.deepEqual(await verifyTeamsAinCallProof(request(identity), { secret, issuer, now, allowDiscovery: true, claimNonce: async () => true }), identity);
  await assert.rejects(verifyTeamsAinCallProof(request({ ...identity, instanceId: null }), { secret, issuer, now, allowDiscovery: true, claimNonce: async () => true }), TeamsAinCallProofDenied);
});
