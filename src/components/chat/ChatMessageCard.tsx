'use client';

import { ChatMessage, useAgentStore, useGameStateStore } from '@/stores';
import { useMemo } from 'react';
import { AgentProfile } from '@/components/AgentProfile';
import ReactMarkdown from 'react-markdown';

const PROFILE_SIZE = 30;

export default function ChatMessageCard({ message }: { message: ChatMessage }) {
    const { getAgentByName } = useAgentStore();
    const { worldPosition: playerPosition } = useGameStateStore();

    const agent = getAgentByName(message.senderId || '');

    const getAgentNameAndPosition = useMemo(() => {
        if (!message.senderId) return 'AI';
        // Try to find agent by ID first, then by name (for SSE stream messages)
        // FIXME(yoojin): need to change senderId to agent id. now senderId is agent name.
        const agent = getAgentByName(message.senderId);
        if (agent && playerPosition) {
            const distance = Math.sqrt(
                Math.pow(agent.x - playerPosition.x, 2) + Math.pow(agent.y - playerPosition.y, 2)
            );
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
                    imageUrl={message.sender === 'user' ? '/sprite/sprite_user.png' : agent?.spriteUrl}
                />
                <span className={`text-sm font-normal ${message.sender === 'user' ? 'text-orange-300' : 'text-blue-300'}`}>
                    {renderSenderName}
                </span>
            </div>
            <div className='justify-start font-semibold leading-[25px] text-white prose prose-invert prose-sm max-w-none'>
                <ReactMarkdown
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