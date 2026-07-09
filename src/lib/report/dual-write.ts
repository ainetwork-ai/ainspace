import type { IngestPayload } from '@/types/ingest';

// EPIC21: best-effort, fire-and-forget dual-write of a single conversation turn to
// the report orchestrator, via the BFF (/api/report-ingest injects the server-only
// INGEST_TOKEN).
//
// CRITICAL invariants (report replication must NEVER degrade chat UX):
//   - NEVER awaited by the chat path.
//   - NEVER throws — every failure path is swallowed here.
//   - Does not touch chat state (loading, rendering, timeouts).
//
// The BFF route silently no-ops when the orchestrator is unconfigured, so callers
// need not know whether ingest is configured — they always just fire and forget.
export function dualWriteTurn(payload: IngestPayload): void {
  try {
    // `keepalive` lets the POST survive an unmount/navigation that races the turn
    // (turns are tiny, well under the keepalive body cap). The promise is
    // deliberately detached (`void`) and its rejection swallowed.
    void fetch('/api/report-ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {
      // Swallow — report replication is eventually-consistent and must never
      // surface in the chat UI.
    });
  } catch {
    // Guard even the synchronous throw path (e.g. a body that can't be
    // serialised). Best-effort: on any failure, do nothing.
  }
}
