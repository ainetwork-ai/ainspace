'use client';

import { ChatMessage, useAgentStore, useGameStateStore } from "@/stores";
import Image from "next/image";
import { useMemo } from "react";

export default function ChatMessageCard({ message }: { message: ChatMessage }) {
  const { agents } = useAgentStore();
  const { worldPosition: playerPosition } = useGameStateStore();
  
  const getAgentNameAndPosition = useMemo(() => {
    if (!message.senderId) return 'AI';
    // Try to find agent by ID first, then by name (for SSE stream messages)
    // FIXME(yoojin): need to change senderId to agent id. now senderId is agent name.
    const agent = agents.find((agent) => agent.name === message.senderId);
    if (agent && playerPosition) {
        const distance = Math.sqrt(
            Math.pow(agent.x - playerPosition.x, 2) + Math.pow(agent.y - playerPosition.y, 2)
        );
        return `${agent.name} (${agent.x}, ${agent.y}) [${distance.toFixed(1)}u]`;
    }
    // If agent not found in local agents array, just return the senderId as name
    return message.senderId || 'AI';
}, [agents, playerPosition, message.senderId]);

const renderSenderName = message.sender === 'user' ? 'Me' : getAgentNameAndPosition


  return (
    <div className="flex flex-col items-start gap-1">
        <div className="flex flex-row items-center gap-2">
            <Image src={"/chat/default_profile.png"} alt="Profile" width={30} height={30} />
            <span className="text-sm font-normal text-white">
                {renderSenderName}
            </span>
        </div>
        <p className="justify-start font-semibold leading-[25px] text-white">
            {message.text}
        </p>
    </div>
  );
}