'use client';

import { ChatMessage, useAgentStore, useGameStateStore } from '@/stores';
import { useMemo } from 'react';
import { AgentProfile } from '@/components/AgentProfile';
import { calculateDistance } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

const PROFILE_SIZE = 30;

export default function ChatMessageCard({ message }: { message: ChatMessage }) {
    const { getAgentByName, agents } = useAgentStore();
    const { worldPosition: playerPosition } = useGameStateStore();

    const agent = getAgentByName(message.senderId || '');

    // Prefer the local agent-store sprite; fall back to the backend-provided
    // author avatar when the agent isn't spawned locally (unplaced / other
    // village / post-refresh). SSE-streamed messages carry no avatarUrl, so
    // those still rely on the store match.
    const agentImageUrl = agent?.spriteUrl ?? message.avatarUrl;

    // [PROFILE-DEBUG] TEMPORARY (dev experiment) — map shows custom sprite but
    // chat falls back to default for some agents => name match likely unreliable.
    // Log identity fields to decide the right matching key (name vs userId).
    if (message.sender !== 'user') {
        console.log('[PROFILE-DEBUG]', {
            senderId: message.senderId,
            senderUserId: message.senderUserId,
            messageAvatarUrl: message.avatarUrl,
            matchedByName: !!agent,
            matchedSpriteUrl: agent?.spriteUrl,
            resolvedImageUrl: agentImageUrl,
            store: agents.map((a) => ({
                name: a.name,
                backendUuid: (a as unknown as { backendUuid?: string }).backendUuid,
                agentUrl: a.agentUrl,
                hasSprite: !!a.spriteUrl,
            })),
        });
    }

    const getAgentNameAndPosition = useMemo(() => {
        if (!message.senderId) return 'AI';
        // Try to find agent by ID first, then by name (for SSE stream messages)
        // FIXME(yoojin): need to change senderId to agent id. now senderId is agent name.
        const agent = getAgentByName(message.senderId);
        if (agent && playerPosition) {
            const distance = calculateDistance(agent, playerPosition);
            return `${agent.name} (${agent.x}, ${agent.y}) [${distance.toFixed(1)}u]`;
        }
        // If agent not found in local agents array, just return the senderId as name
        return message.senderId || 'AI';
    }, [getAgentByName, playerPosition, message.senderId]);

    const renderSenderName = message.sender === 'user' ? 'Me' : getAgentNameAndPosition;
    
    return (
        <div className='flex flex-col items-start gap-1'>
            <div className='flex flex-row items-center gap-2'>
                <AgentProfile
                    width={PROFILE_SIZE}
                    height={PROFILE_SIZE}
                    imageUrl={message.sender === 'user' ? '/sprite/sprite_user.png' : agentImageUrl}
                />
                <span className={`text-sm font-normal ${message.sender === 'user' ? 'text-orange-300' : 'text-blue-300'}`}>
                    {renderSenderName}
                </span>
            </div>
            <div className='justify-start font-semibold leading-[25px] text-white prose prose-invert prose-sm max-w-none'>
                <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeSanitize]}
                    components={{
                        a: ({ node, ...props }) => (
                            <a
                                {...props}
                                className="text-blue-400 underline hover:text-blue-300 visited:text-purple-400"
                                target="_blank"
                                rel="noopener noreferrer"
                            />
                        ),
                    }}
                >
                    {message.text}
                </ReactMarkdown>
            </div>
        </div>
    );
}