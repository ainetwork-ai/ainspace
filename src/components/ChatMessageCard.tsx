'use client';

import { TILE_SIZE } from '@/constants/game';
import { ChatMessage, useAgentStore, useGameStateStore } from '@/stores';
import Image from 'next/image';
import { useMemo, useState } from 'react';

const PROFILE_SIZE = 30;
const IMAGE_X_START_POSITION = (TILE_SIZE - PROFILE_SIZE) / 2 * -1;

export default function ChatMessageCard({ message }: { message: ChatMessage }) {
    const { getAgentByName } = useAgentStore();
    const { worldPosition: playerPosition } = useGameStateStore();

    const agent = getAgentByName(message.senderId || '');

    // FIXME(yoojin): need system profile image.
    const [imgUrl] = useState<string>(agent?.spriteUrl || '/sprite/sprite_user.png');

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
    const renderAgentProfile = () => {
        return (
            <div className='bg-white flex items-center justify-center w-[30px] h-[30px] overflow-hidden relative rounded-sm'>
                <div className='w-[40px] h-[40px]'>
                    <Image
                      src={imgUrl}
                      alt='Profile'
                      className='absolute object-none'
                      fill
                      unoptimized
                      style={{ objectPosition: `${IMAGE_X_START_POSITION}px 0`, top: 0, left: 0}}
                    />
                </div>
            </div>
        )
    }

    return (
        <div className='flex flex-col items-start gap-1'>
            <div className='flex flex-row items-center gap-2'>
                {renderAgentProfile()}
                <span className={`text-sm font-normal ${message.sender === 'user' ? 'text-orange-300' : 'text-blue-300'}`}>
                    {renderSenderName}
                </span>
            </div>
            <p className='justify-start font-semibold leading-[25px] text-white'>
                {message.text}
            </p>
        </div>
    );
}