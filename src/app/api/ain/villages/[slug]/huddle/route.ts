import { type NextRequest, NextResponse } from 'next/server';
import { villageDeps } from '@/lib/ain-integration/deps';
import { authorizeVillagePresence, VillagePresenceAuthError } from '@/lib/village-presence-auth';
import { hasVillageConnection } from '@/lib/village-connection-presence';
import { authorizeVillageHuddle, VillageHuddleDenied } from '@/lib/village-huddle-access';
import { villageHuddleInstance } from '@/lib/village-huddle-instance';
import { huddleLaunchUrl } from '@/lib/huddle-launch-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };

/** Room access descriptor only. Media credentials are issued by the shared Teams Huddle service. */
export async function GET(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  try {
    const userId = await authorizeVillagePresence(request, undefined);
    const { slug } = await context.params;
    const access = await authorizeVillageHuddle(slug, userId, villageDeps.directory, hasVillageConnection);
    const instance = await villageHuddleInstance(slug);
    if (!instance) throw new VillageHuddleDenied();
    return NextResponse.json({ ...access, ...instance, joinUrl: huddleLaunchUrl(process.env.AIN_TEAMS_HUDDLE_URL, slug) }, { headers });
  } catch (error) {
    const status = error instanceof VillagePresenceAuthError ? error.status : error instanceof VillageHuddleDenied ? 404 : 503;
    return NextResponse.json({ error: 'Village huddle unavailable' }, { status, headers });
  }
}
