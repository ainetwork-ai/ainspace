import { NextRequest, NextResponse } from 'next/server';
import { parseHuddleMentionQuery } from '@/lib/huddle-mention-query';
import { villageDeps } from '@/lib/ain-integration/deps';
import { verifyTeamsHuddleProof, TeamsHuddleProofDenied } from '@/lib/teams-huddle-proof';
import { getStorageClient } from '@/lib/storage';
import { hasVillageConnection, listLiveVillageConnections } from '@/lib/village-connection-presence';
import { authorizeVillageHuddle, VillageHuddleDenied } from '@/lib/village-huddle-access';
import { villageHuddleInstance } from '@/lib/village-huddle-instance';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
export async function POST(request: NextRequest) {
  const secret = process.env.AIN_TEAMS_HUDDLE_SECRET ?? '';
  const issuer = process.env.AIN_TEAMS_HUDDLE_SSO_ISSUER ?? '';
  if (Buffer.byteLength(secret) < 32 || !issuer) return NextResponse.json({ error: 'Space search unavailable' }, { status: 503, headers });
  try {
    const principal = await verifyTeamsHuddleProof(request, { secret, issuer, claimNonce: async nonce => {
      const storage = await getStorageClient();
      return await storage.claimOnce(`ain:teams-huddle-nonce:${nonce}`, 90) === 'OK';
    } });
    const actor = principal.userId; const slug = principal.slug;
    const query = parseHuddleMentionQuery(request.nextUrl.searchParams, false);
    if (!query) return NextResponse.json({ error: 'Invalid search' }, { status: 400, headers });
    await authorizeVillageHuddle(slug, actor, villageDeps.directory, hasVillageConnection);
    const initial = await villageHuddleInstance(slug);
    if (!initial || initial.instanceId !== principal.instanceId) throw new VillageHuddleDenied();
    const [members, owner, present] = await Promise.all([villageDeps.directory.listMembers(slug), villageDeps.directory.getOwner(slug), listLiveVillageConnections(slug)]);
    const ids = [...new Set([...members, ...(owner ? [owner] : []), ...present])].filter(id => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)).sort();
    await authorizeVillageHuddle(slug, actor, villageDeps.directory, hasVillageConnection);
    if ((await villageHuddleInstance(slug))?.instanceId !== initial.instanceId) throw new VillageHuddleDenied();
    const remaining = ids.filter(id => !query.after || id > query.after);
    const page = remaining.slice(0, 50);
    return NextResponse.json({ ids: page, next: remaining.length > 50 ? page.at(-1) : null }, { headers });
  } catch (error) {
    return NextResponse.json({ error: 'Space search unavailable' }, { status: error instanceof TeamsHuddleProofDenied ? 401 : error instanceof VillageHuddleDenied ? 404 : 503, headers });
  }
}
