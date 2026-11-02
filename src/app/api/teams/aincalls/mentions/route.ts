import { NextRequest, NextResponse } from 'next/server';
import { parseAinCallMentionQuery } from '@/lib/aincall-mention-query';
import { villageDeps } from '@/lib/ain-integration/deps';
import { verifyTeamsAinCallProof, TeamsAinCallProofDenied } from '@/lib/teams-aincall-proof';
import { getStorageClient } from '@/lib/storage';
import { hasVillageConnection, listLiveVillageConnections } from '@/lib/village-connection-presence';
import { authorizeVillageAinCall, VillageAinCallDenied } from '@/lib/village-aincall-access';
import { villageAinCallInstance } from '@/lib/village-aincall-instance';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
export async function POST(request: NextRequest) {
  const secret = process.env.AIN_TEAMS_AINCALL_SECRET ?? '';
  const issuer = process.env.AIN_TEAMS_AINCALL_SSO_ISSUER ?? '';
  if (Buffer.byteLength(secret) < 32 || !issuer) return NextResponse.json({ error: 'Space search unavailable' }, { status: 503, headers });
  try {
    const principal = await verifyTeamsAinCallProof(request, { secret, issuer, claimNonce: async nonce => {
      const storage = await getStorageClient();
      return await storage.claimOnce(`ain:teams-aincall-nonce:${nonce}`, 90) === 'OK';
    } });
    const actor = principal.userId; const slug = principal.slug;
    const query = parseAinCallMentionQuery(request.nextUrl.searchParams, false);
    if (!query) return NextResponse.json({ error: 'Invalid search' }, { status: 400, headers });
    await authorizeVillageAinCall(slug, actor, villageDeps.directory, hasVillageConnection);
    const initial = await villageAinCallInstance(slug);
    if (!initial || initial.instanceId !== principal.instanceId) throw new VillageAinCallDenied();
    const [members, owner, present] = await Promise.all([villageDeps.directory.listMembers(slug), villageDeps.directory.getOwner(slug), listLiveVillageConnections(slug)]);
    const ids = [...new Set([...members, ...(owner ? [owner] : []), ...present])].filter(id => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)).sort();
    await authorizeVillageAinCall(slug, actor, villageDeps.directory, hasVillageConnection);
    if ((await villageAinCallInstance(slug))?.instanceId !== initial.instanceId) throw new VillageAinCallDenied();
    const remaining = ids.filter(id => !query.after || id > query.after);
    const page = remaining.slice(0, 50);
    return NextResponse.json({ ids: page, next: remaining.length > 50 ? page.at(-1) : null }, { headers });
  } catch (error) {
    return NextResponse.json({ error: 'Space search unavailable' }, { status: error instanceof TeamsAinCallProofDenied ? 401 : error instanceof VillageAinCallDenied ? 404 : 503, headers });
  }
}
