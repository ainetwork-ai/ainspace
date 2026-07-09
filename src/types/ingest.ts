// EPIC21: report dual-write ingest contract (ainspace -> a2a-orchestrator).
// 1:1 with the frozen shared contract `POST /api/ingest/conversation`
// (a2a-orchestrator EPIC8). Data flows ONE way (ainspace -> orchestrator); the
// shared backend knows nothing about reports.
//
// The endpoint is IDEMPOTENT per message id (re-POST of the same id is skipped)
// and supports incremental/partial posts: the user turn and each agent turn may
// arrive in SEPARATE posts — the first upserts the thread, later ones append.

export interface IngestAgent {
  // REQUIRED, unique within the thread — the speaker join key for agent turns
  // (an agent turn's `speaker` must equal one of these `name`s).
  name: string;
  // Canonical A2A id used by the report agentUrls filter. Optional per the frozen
  // contract ("recommended; absence is NOT a hard-fail") — we omit it best-effort
  // when it cannot be resolved locally rather than failing the turn.
  // NOTE: the EPIC21 Story 21.1 sketch typed this as required; reconciled to
  // optional to match the frozen shared contract exactly (and to make the
  // best-effort-omit behaviour type-correct).
  a2aUrl?: string;
  // Agent's backend `users.id` (reconcile key). Additive field — the frozen
  // contract's canonical agents[] shape does not list it, so the orchestrator may
  // currently ignore it; carried for future cross-reference with the shared backend.
  backendAgentId?: string;
  role?: string;
  color?: string;
}

export interface IngestThread {
  // = backend conversationId. Identity-mapped to the orchestrator thread id
  // (see src/lib/report/thread-mapping.ts).
  id: string;
  name?: string;
  // REQUIRED = backend `users.id` (the id ainspace already holds for auth) —
  // NOT the wallet address and NOT the display name.
  userId: string;
  agents: IngestAgent[];
}

export interface IngestMessage {
  id: string;
  // "User" (exact) for the human turn, or the agent display name (= agents[].name)
  // for an agent turn.
  speaker: string;
  content: string;
  // Epoch milliseconds.
  timestamp: number;
  // Present on agent turns when resolvable (the speaking agent's a2aUrl).
  senderA2aUrl?: string;
  replyTo?: string;
  status?: 'accepted' | 'dropped';
}

export interface IngestPayload {
  thread: IngestThread;
  messages: IngestMessage[];
}

export interface IngestResponse {
  ok: boolean;
  threadId: string;
  ingested: number;
  skipped: number;
}
