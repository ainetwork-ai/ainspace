import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { villageDeps } from '@/lib/ain-integration/deps';
import { authorizeVillagePresence, VillagePresenceAuthError } from '@/lib/village-presence-auth';
import { hasVillageConnection, listLiveVillageConnections } from '@/lib/village-connection-presence';
import { authorizeVillageAinCall, VillageAinCallDenied } from '@/lib/village-aincall-access';
import { villageAinCallInstance } from '@/lib/village-aincall-instance';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
export async function GET(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  try {
    const actor = await authorizeVillagePresence(request, undefined);
    const { slug } = await context.params;
    const entries = [...request.nextUrl.searchParams.entries()];
    const query = z.object({ instanceId: z.string().uuid(), after: z.string().uuid().optional() }).strict().safeParse(Object.fromEntries(entries));
    if (!query.success || new Set(entries.map(([key]) => key)).size !== entries.length) return NextResponse.json({ error: 'Invalid search' }, { status: 400, headers });
    await authorizeVillageAinCall(slug, actor, villageDeps.directory, hasVillageConnection);
    const initial = await villageAinCallInstance(slug);
    if (!initial || initial.instanceId !== query.data.instanceId) throw new VillageAinCallDenied();
    const [members, owner, present] = await Promise.all([villageDeps.directory.listMembers(slug), villageDeps.directory.getOwner(slug), listLiveVillageConnections(slug)]);
    const ids = [...new Set([...members, ...(owner ? [owner] : []), ...present])].filter(id => z.string().uuid().safeParse(id).success).sort();
    await authorizeVillageAinCall(slug, actor, villageDeps.directory, hasVillageConnection);
    if ((await villageAinCallInstance(slug))?.instanceId !== initial.instanceId) throw new VillageAinCallDenied();
    const remaining = ids.filter(id => !query.data.after || id > query.data.after);
    const page = remaining.slice(0, 50);
    return NextResponse.json({ ids: page, next: remaining.length > 50 ? page.at(-1) : null }, { headers });
  } catch (error) {
    return NextResponse.json({ error: 'Space search unavailable' }, { status: error instanceof VillagePresenceAuthError ? error.status : error instanceof VillageAinCallDenied ? 404 : 503, headers });
  }
}
