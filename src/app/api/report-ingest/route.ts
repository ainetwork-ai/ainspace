import { NextRequest, NextResponse } from 'next/server';
import { INGEST_TOKEN, ORCHESTRATOR_URL, isReportIngestConfigured } from '@/lib/backend/config';

/**
 * POST /api/report-ingest
 * EPIC21: best-effort dual-write BFF. The browser POSTs an assembled IngestPayload
 * here; this route injects the SERVER-ONLY `INGEST_TOKEN` as a Bearer header and
 * proxies it to the orchestrator's `POST /api/ingest/conversation`. The token
 * never reaches the browser (not NEXT_PUBLIC).
 *
 * This route is NOT tied to the user's backend session — the orchestrator is a
 * separate service with its own auth domain, so no backend JWT is required or
 * forwarded here.
 *
 * The client fires this fire-and-forget and ignores the result, so every path
 * returns a shape the client can safely discard. Unconfigured installs (or any
 * upstream failure) resolve as a benign 200 no-op so dual-write can never surface
 * as a chat error.
 */
export async function POST(request: NextRequest) {
  // Secret gate: the route exists everywhere but no-ops silently when the
  // orchestrator/token aren't configured (closed-network / unconfigured installs).
  if (!isReportIngestConfigured()) {
    return NextResponse.json({ ok: false, skipped: true });
  }

  try {
    // Pass the body through verbatim — this route is a thin authenticated proxy,
    // not a validator (the payload was assembled to contract by the client).
    const body = await request.text();

    const res = await fetch(`${ORCHESTRATOR_URL}/api/ingest/conversation`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${INGEST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body,
    });

    // Forward the orchestrator's status/body. The client ignores this (fire-and-
    // forget), so a non-2xx upstream status is surfaced for debuggability only and
    // never blocks chat.
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
    });
  } catch (error) {
    // Network failure / timeout to the orchestrator MUST NOT bubble into chat.
    // Log quietly and return a benign no-op so the client's .catch() need not even
    // trip.
    console.warn(
      '[report-ingest] dual-write proxy failed (best-effort, ignored):',
      error instanceof Error ? error.message : error
    );
    return NextResponse.json({ ok: false, skipped: true });
  }
}
