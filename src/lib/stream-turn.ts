/**
 * Agent-turn streaming for the orchestration SSE (ainteams backend).
 *
 * A streaming agent's turn arrives as `delta` events (the accumulated text so far,
 * not increments) followed by the final `message` event carrying the same `turnId`.
 * The delta draws a provisional bubble keyed by the turn; the message replaces it
 * with the persisted row (id, files). A non-streaming agent sends no delta, so the
 * message simply appends as before. Pure functions so the merge is testable
 * without React.
 */
import type { ChatMessage } from '@/stores/useChatStore';

export interface DeltaEventData {
    turnId?: string;
    speaker?: string;
    userId?: string;
    content?: string;
}

/** The provisional bubble's id — one per turn, replaced by the final message. */
export const turnMessageId = (turnId: string): string => `turn-${turnId}`;

/** Upsert the provisional bubble for a delta. Returns the same array when nothing changes. */
export function applyDelta(
    messages: ChatMessage[],
    delta: DeltaEventData,
    threadId: string | undefined,
    now: Date = new Date(),
): ChatMessage[] {
    if (!delta.turnId || typeof delta.content !== 'string') return messages;
    const id = turnMessageId(delta.turnId);
    const index = messages.findIndex((m) => m.id === id);
    if (index >= 0) {
        if (messages[index].text === delta.content) return messages;
        const next = messages.slice();
        next[index] = { ...messages[index], text: delta.content };
        return next;
    }
    if (!delta.content) return messages;
    return [
        ...messages,
        {
            id,
            text: delta.content,
            timestamp: now,
            sender: 'ai',
            senderId: delta.speaker || 'agent',
            senderUserId: delta.userId,
            threadId,
            streaming: true,
        },
    ];
}

/**
 * Place the final message: replace its turn's provisional bubble in place (so the
 * bubble does not jump), or append when there was none. Already-present ids are
 * left alone (the stream can redeliver on reconnect).
 */
export function applyFinalMessage(messages: ChatMessage[], message: ChatMessage, turnId?: string): ChatMessage[] {
    if (messages.some((m) => m.id === message.id)) return messages;
    if (turnId) {
        const index = messages.findIndex((m) => m.id === turnMessageId(turnId));
        if (index >= 0) {
            const next = messages.slice();
            next[index] = message;
            return next;
        }
    }
    return [...messages, message];
}
