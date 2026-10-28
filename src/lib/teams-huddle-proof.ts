import { createHmac, timingSafeEqual } from 'node:crypto';

export class TeamsHuddleProofDenied extends Error {}
export type TeamsHuddlePrincipal = { userId: string; issuer: string; subject: string; slug: string; instanceId?: string };
/** Only the configured Teams server may attest its linked backend/SSO identity. */
export async function verifyTeamsHuddleProof(request: Request, options: {
  secret: string; issuer: string; now?: number; allowDiscovery?: boolean;
  claimNonce(nonce: string): Promise<boolean>;
}): Promise<TeamsHuddlePrincipal> {
  const deny = () => { throw new TeamsHuddleProofDenied('Huddle authority unavailable'); };
  const timestamp = request.headers.get('X-Ain-Timestamp') ?? '';
  const nonce = request.headers.get('X-Ain-Nonce') ?? '';
  const signature = request.headers.get('X-Ain-Signature') ?? '';
  if (Buffer.byteLength(options.secret) < 32 || !options.issuer || !/^\d{13}$/.test(timestamp) ||
      Math.abs((options.now ?? Date.now()) - Number(timestamp)) > 30_000 ||
      !/^[a-f0-9]{32}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(signature)) return deny();
  if (!request.body) return deny();
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      length += chunk.value.byteLength; if (length > 4096) return deny(); chunks.push(chunk.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const body = Buffer.concat(chunks).toString('utf8');
  const expected = createHmac('sha256', options.secret).update(`ain-space.huddle-authority.v1\n${timestamp}\n${nonce}\n${body}`).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) return deny();
  let value: unknown; try { value = JSON.parse(body); } catch { return deny(); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return deny();
  const principal = value as Record<string, unknown>;
  const discovery = options.allowDiscovery && !Object.hasOwn(principal, 'instanceId');
  if (Object.keys(principal).sort().join(',') !== (discovery ? 'issuer,slug,subject,userId' : 'instanceId,issuer,slug,subject,userId') ||
      principal.issuer !== options.issuer ||
      typeof principal.userId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(principal.userId) ||
      typeof principal.subject !== 'string' || !principal.subject || principal.subject.length > 500 ||
      typeof principal.slug !== 'string' || !/^[a-z0-9-]{1,64}$/.test(principal.slug) ||
      !discovery && (typeof principal.instanceId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(principal.instanceId))) return deny();
  // Atomic one-use storage must succeed; an unavailable replay store must not authorize.
  if (!await options.claimNonce(nonce)) return deny();
  return principal as TeamsHuddlePrincipal;
}
