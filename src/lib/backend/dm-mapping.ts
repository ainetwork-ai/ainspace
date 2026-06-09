import { Thread } from '@/types/thread';
import { generateAgentComboId } from '@/lib/hash';

// Map backend DM/message shapes to the ainspace shapes the chat UI already
// consumes, so ChatBox/Overlay/SidebarPanel render identically after the
// orchestration→backend migration. Backend source of truth:
//   backend/src/domain/dm/dm.service.ts {listConversations, listMessages}

export interface BackendDmMember {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  isAgent: boolean;
  status?: string;
  ainAddress?: string | null;
  a2aId?: string | null;
}

export interface BackendDmListItem {
  id: string;
  shortId?: string;
  workspaceId?: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  members: BackendDmMember[];
  otherUser: { id: string; displayName: string; isAgent: boolean } | null;
  isGroup: boolean;
  latestMessage: { id: string; content: string; createdAt: string | Date; userId: string } | null;
  unreadCount?: number;
  unread?: boolean;
  isMuted?: boolean;
}

export interface BackendDmMessage {
  id: string;
  content: string;
  createdAt: string | Date;
  userId: string;
  user?: { id: string; displayName: string; isAgent: boolean };
}

const toIso = (v: string | Date): string =>
  typeof v === 'string' ? v : v.toISOString();

export async function mapDmToThread(dm: BackendDmListItem): Promise<Thread> {
  const agentNames = dm.members.filter((m) => m.isAgent).map((m) => m.displayName);
  const sortedAgentNames = [...agentNames].sort();
  // Match ChatBox.generateThreadName(line 147-153): sorted agent names joined,
  // stripped of punctuation outside [a-z0-9가-힣\s,]. Falls back to otherUser
  // when there are no agent members (rare — e.g., self-DM).
  const threadName =
    sortedAgentNames.length > 0
      ? sortedAgentNames.join(', ').replace(/[^a-z0-9가-힣\s,]/gi, '')
      : (dm.otherUser?.displayName ?? '');
  const agentComboId =
    sortedAgentNames.length > 0 ? await generateAgentComboId(sortedAgentNames) : '';
  const lastMessageAt = dm.latestMessage
    ? toIso(dm.latestMessage.createdAt)
    : toIso(dm.updatedAt);
  return {
    id: dm.id,
    threadName,
    agentNames,
    agentComboId,
    createdAt: toIso(dm.createdAt),
    lastMessageAt,
    hasUnplacedAgents: false,
  };
}

// Matches ChatBox.mappingBackendMessagesToChatMessages (line 91-106):
//   speaker === 'User' decides user/ai; uses {id, content, timestamp, speaker}.
export function mapBackendMessageToAinspace(m: BackendDmMessage): {
  id: string;
  content: string;
  timestamp: string;
  speaker: string;
} {
  const isAgent = m.user?.isAgent ?? false;
  const speaker = isAgent ? (m.user?.displayName ?? 'agent') : 'User';
  return {
    id: m.id,
    content: m.content,
    timestamp: toIso(m.createdAt),
    speaker,
  };
}
