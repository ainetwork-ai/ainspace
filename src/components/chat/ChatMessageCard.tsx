'use client';

import { ChatMessage, useAgentStore, useGameStateStore } from '@/stores';
import { useMemo } from 'react';
import { AgentProfile } from '@/components/AgentProfile';
import { calculateDistance } from '@/lib/utils';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import ChatImage from '@/components/chat/ChatImage';

const PROFILE_SIZE = 30;

// Stable module-level markdown config. These MUST NOT be recreated per render:
// ChatMessageCard re-renders frequently (it subscribes to player/agent position,
// which updates via autonomous movement ~every 1.5s). If `components`/plugins are
// new identities each render, react-markdown remounts the rendered nodes (incl.
// <a>) every time, so a single link click's mousedown and click land on different
// DOM nodes and the click is dropped — the reason links needed a double-click.
const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeSanitize];
const MARKDOWN_COMPONENTS: Components = {
    a: ({ node, ...props }) => (
        <a
            {...props}
            className="text-blue-400 underline hover:text-blue-300 visited:text-purple-400"
            target="_blank"
            rel="noopener noreferrer"
        />
    ),
};

export default function ChatMessageCard({ message }: { message: ChatMessage }) {
    const { getAgentByName, agents } = useAgentStore();
    const { worldPosition: playerPosition } = useGameStateStore();

    // Match the message author to a local agent by the stable backend UUID
    // first (displayName is unreliable — backend may suffix it, e.g.
    // "WarmHeart" -> "WarmHeart22"), then fall back to name matching.
    const agentByUuid = message.senderUserId
        ? agents.find((a) => a.backendUuid && a.backendUuid === message.senderUserId)
        : undefined;
    const agent = agentByUuid ?? getAgentByName(message.senderId || '');

    // Prefer the local agent-store sprite; fall back to the backend-provided
    // author avatar when the agent isn't spawned locally.
    const agentImageUrl = agent?.spriteUrl ?? message.avatarUrl;

    const getAgentNameAndPosition = useMemo(() => {
        if (!message.senderId) return 'AI';
        // Reuse the agent matched above (by backend UUID, then name).
        if (agent && playerPosition) {
            const distance = calculateDistance(agent, playerPosition);
            return `${agent.name} (${agent.x}, ${agent.y}) [${distance.toFixed(1)}u]`;
        }
        // If agent not found in local agents array, just return the senderId as name
        return message.senderId || 'AI';
    }, [agent, playerPosition, message.senderId]);

    const renderSenderName = message.sender === 'user' ? 'Me' : getAgentNameAndPosition;
    
    return (
        <div className='flex w-full min-w-0 flex-col items-start gap-1'>
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
            {/* max-w-full + min-w-0 + overflow-wrap:anywhere keep long unbreakable
                tokens (URLs w/o break points, code spans, code blocks) from
                overflowing the chat width. Without these, items-start lets a flex
                child grow to its content's min-content width, and the message
                list's overflow-y-auto promotes overflow-x to auto -> a horizontal
                scrollbar on the whole chat. */}
            <div className='justify-start font-semibold leading-[25px] text-white prose prose-invert prose-sm max-w-full min-w-0 [overflow-wrap:anywhere]'>
                <ReactMarkdown
                    remarkPlugins={REMARK_PLUGINS}
                    rehypePlugins={REHYPE_PLUGINS}
                    components={MARKDOWN_COMPONENTS}
                >
                    {message.text}
                </ReactMarkdown>
            </div>
            {/* EPIC22: agent-sent images — laid out in a row, wrapping to a new
                line when horizontal space runs out. Kept OUTSIDE the `prose`
                wrapper so typography's large img margins don't inflate the gap;
                spacing is controlled by the flex `gap`. */}
            {message.files?.some((f) => f.mimeType?.startsWith('image/')) && (
                <div className='flex flex-row flex-wrap gap-2'>
                    {message.files.map((f, idx) =>
                        f.mimeType?.startsWith('image/') ? (
                            <ChatImage key={f.fileUrl || idx} file={f} />
                        ) : null
                    )}
                </div>
            )}
        </div>
    );
}