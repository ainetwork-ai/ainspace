import { NextResponse } from 'next/server';
import { verifyTeamsHuddleProof, TeamsHuddleProofDenied } from '@/lib/teams-huddle-proof';
import { getStorageClient } from '@/lib/storage';
import { villageDeps } from '@/lib/ain-integration/deps';
import { authorizeVillageHuddle, VillageHuddleDenied } from '@/lib/village-huddle-access';
import { villageHuddleInstance } from '@/lib/village-huddle-instance';
import { hasVillageConnection } from '@/lib/village-connection-presence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
/** Internal caller supplies a server-verified linked identity, never a browser account claim. */
export async function POST(request: Request) {
  const secret = process.env.AIN_TEAMS_HUDDLE_SECRET ?? '';
  const issuer = process.env.AIN_TEAMS_HUDDLE_SSO_ISSUER ?? '';
  if (Buffer.byteLength(secret) < 32 || !issuer) return NextResponse.json({ error: 'Huddle authority unavailable' }, { status: 503, headers });
  try {
    const principal = await verifyTeamsHuddleProof(request, { secret, issuer, allowDiscovery: true, claimNonce: async nonce => {
      const storage = await getStorageClient();
      return await storage.claimOnce(`ain:teams-huddle-nonce:${nonce}`, 90) === 'OK';
    } });
    const access = await authorizeVillageHuddle(principal.slug, principal.userId, villageDeps.directory, hasVillageConnection);
    const instance = await villageHuddleInstance(principal.slug);
    if (!instance || principal.instanceId !== undefined && instance.instanceId !== principal.instanceId) throw new VillageHuddleDenied();
    return NextResponse.json({ ...access, ...instance }, { headers });
  } catch (error) {
    return NextResponse.json({ error: 'Huddle authority unavailable' }, { status: error instanceof TeamsHuddleProofDenied ? 401 : error instanceof VillageHuddleDenied ? 404 : 503, headers });
  }
}
