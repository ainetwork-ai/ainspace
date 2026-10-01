import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Deployment identity comes from the hosting environment, never the current
// GitHub branch: an older running release must report its own commit.
export async function GET() {
    const candidate = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_SHA ?? '';
    const sha = /^[a-f0-9]{40}$/.test(candidate) ? candidate : null;
    return NextResponse.json(
        { status: 'ok', sha },
        { headers: { 'Cache-Control': 'no-store' } }
    );
}
