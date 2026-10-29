import { NextRequest, NextResponse } from 'next/server';
import { parseHuddleMentionQuery } from '@/lib/huddle-mention-query';
import { villageDeps } from '@/lib/ain-integration/deps';
import { authorizeVillagePresence, VillagePresenceAuthError } from '@/lib/village-presence-auth';
import { hasVillageConnection, listLiveVillageConnections } from '@/lib/village-connection-presence';
import { authorizeVillageHuddle, VillageHuddleDenied } from '@/lib/village-huddle-access';
import { villageHuddleInstance } from '@/lib/village-huddle-instance';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
export async function GET(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  try {
    const actor = await authorizeVillagePresence(request, undefined);
    const { slug } = await context.params;
    const query = parseHuddleMentionQuery(request.nextUrl.searchParams, true);
    if (!query) return NextResponse.json({ error: 'Invalid search' }, { status: 400, headers });
    await authorizeVillageHuddle(slug, actor, villageDeps.directory, hasVillageConnection);
    const initial = await villageHuddleInstance(slug);
    if (!initial || initial.instanceId !== query.instanceId) throw new VillageHuddleDenied();
    const [members, owner, present] = await Promise.all([villageDeps.directory.listMembers(slug), villageDeps.directory.getOwner(slug), listLiveVillageConnections(slug)]);
    const ids = [...new Set([...members, ...(owner ? [owner] : []), ...present])].filter(id => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)).sort();
    await authorizeVillageHuddle(slug, actor, villageDeps.directory, hasVillageConnection);
    if ((await villageHuddleInstance(slug))?.instanceId !== initial.instanceId) throw new VillageHuddleDenied();
    const remaining = ids.filter(id => !query.after || id > query.after);
    const page = remaining.slice(0, 50);
    return NextResponse.json({ ids: page, next: remaining.length > 50 ? page.at(-1) : null }, { headers });
  } catch (error) {
    return NextResponse.json({ error: 'Space search unavailable' }, { status: error instanceof VillagePresenceAuthError ? error.status : error instanceof VillageHuddleDenied ? 404 : 503, headers });
  }
}
