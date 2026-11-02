import { type NextRequest, NextResponse } from 'next/server';
import { villageDeps } from '@/lib/ain-integration/deps';
import { authorizeVillagePresence, VillagePresenceAuthError } from '@/lib/village-presence-auth';
import { hasVillageConnection } from '@/lib/village-connection-presence';
import { authorizeVillageAinCall, VillageAinCallDenied } from '@/lib/village-aincall-access';
import { villageAinCallInstance } from '@/lib/village-aincall-instance';
import { aincallLaunchUrl } from '@/lib/aincall-launch-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };

/** Room access descriptor only. Media credentials are issued by the shared Teams AinCall service. */
export async function GET(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  try {
    const userId = await authorizeVillagePresence(request, undefined);
    const { slug } = await context.params;
    const access = await authorizeVillageAinCall(slug, userId, villageDeps.directory, hasVillageConnection);
    const instance = await villageAinCallInstance(slug);
    if (!instance) throw new VillageAinCallDenied();
    return NextResponse.json({ ...access, ...instance, joinUrl: aincallLaunchUrl(process.env.AIN_TEAMS_AINCALL_URL, slug) }, { headers });
  } catch (error) {
    const status = error instanceof VillagePresenceAuthError ? error.status : error instanceof VillageAinCallDenied ? 404 : 503;
    return NextResponse.json({ error: 'Village aincall unavailable' }, { status, headers });
  }
}
