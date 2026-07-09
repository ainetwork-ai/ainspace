// EPIC21: pure assembler from observed conversation turns + local backend identity
// into the frozen ingest contract shape (IngestPayload). Kept side-effect-free (no
// store reads, no I/O) so it is trivially unit-testable — the store resolution that
// feeds it lives at the call site (ChatBox), which owns the zustand access.
//
// Identity rules encoded here (see EPIC21 §식별자):
//   - thread.id      = backend conversationId (routed through orchestratorThreadId())
//   - thread.userId  = backend users.id (NOT wallet address / NOT display name)
//   - agents[]       = name + a2aUrl (canonical filter) + backendAgentId (reconcile)
//   - user turn      -> speaker 'User' (EXACT), no senderA2aUrl
//   - agent turn     -> speaker = display name (= agents[].name), senderA2aUrl = a2aUrl
//   - timestamp      = epoch ms

import type { IngestAgent, IngestMessage, IngestPayload, IngestThread } from '@/types/ingest';
import { orchestratorThreadId } from './thread-mapping';

// Contract-exact speaker string for the human turn. Orchestrator matches on this
// verbatim — never localise / re-case it.
export const USER_SPEAKER = 'User';

export interface IngestAgentInput {
  name: string;
  a2aUrl?: string;
  backendAgentId?: string;
  role?: string;
  color?: string;
}

export type IngestTurnInput =
  | {
      kind: 'user';
      id: string;
      content: string;
      timestamp: number; // epoch ms
      replyTo?: string;
    }
  | {
      kind: 'agent';
      id: string;
      speaker: string; // display name — MUST come from the same source as agents[].name
      content: string;
      timestamp: number; // epoch ms
      senderA2aUrl?: string;
      replyTo?: string;
      status?: 'accepted' | 'dropped';
    };

export interface BuildIngestPayloadInput {
  conversationId: string;
  threadName?: string;
  user: { backendUserId: string };
  agents: IngestAgentInput[];
  turns: IngestTurnInput[];
}

function toIngestAgent(a: IngestAgentInput): IngestAgent {
  const agent: IngestAgent = { name: a.name };
  if (a.a2aUrl) agent.a2aUrl = a.a2aUrl;
  if (a.backendAgentId) agent.backendAgentId = a.backendAgentId;
  if (a.role) agent.role = a.role;
  if (a.color) agent.color = a.color;
  return agent;
}

function toIngestMessage(turn: IngestTurnInput): IngestMessage {
  if (turn.kind === 'user') {
    const msg: IngestMessage = {
      id: turn.id,
      speaker: USER_SPEAKER,
      content: turn.content,
      timestamp: turn.timestamp,
    };
    if (turn.replyTo) msg.replyTo = turn.replyTo;
    return msg;
  }
  const msg: IngestMessage = {
    id: turn.id,
    speaker: turn.speaker,
    content: turn.content,
    timestamp: turn.timestamp,
  };
  if (turn.senderA2aUrl) msg.senderA2aUrl = turn.senderA2aUrl;
  if (turn.replyTo) msg.replyTo = turn.replyTo;
  if (turn.status) msg.status = turn.status;
  return msg;
}

export function buildIngestPayload(input: BuildIngestPayloadInput): IngestPayload {
  const thread: IngestThread = {
    id: orchestratorThreadId(input.conversationId),
    userId: input.user.backendUserId,
    agents: input.agents.map(toIngestAgent),
  };
  if (input.threadName) thread.name = input.threadName;

  return {
    thread,
    messages: input.turns.map(toIngestMessage),
  };
}
