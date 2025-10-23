'use client';

import Image from 'next/image';
import React, { useState } from 'react';
import { AgentCard } from '@a2a-js/sdk';
import { SpriteAnimator } from 'react-sprite-animator';
import BaseTabContent from './BaseTabContent';
import { Trash2Icon } from 'lucide-react';

interface ImportedAgent {
    url: string;
    card: AgentCard;
    spriteUrl?: string;
    spriteHeight?: number;
}

interface AgentTabProps {
    isActive: boolean;
    onSpawnAgent: (agent: ImportedAgent) => void;
    onRemoveAgentFromMap: (agentUrl: string) => void;
    spawnedAgents: string[];
}

const SPRITE_OPTIONS = [
    { name: 'Cat', url: '/sprite/sprite_cat.png', height: 40 },
    { name: 'Default 1', url: '/sprite/sprite_default_1.png', height: 86 },
    { name: 'Default 2', url: '/sprite/sprite_default_2.png', height: 86 }
];

// Animated sprite preview component
function SpritePreview({
    spriteUrl,
    spriteHeight,
    isSelected,
    onClick
}: {
    spriteUrl: string;
    spriteHeight: number;
    isSelected: boolean;
    onClick: () => void;
}) {
    return (
        <div
            onClick={onClick}
            className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 p-2 transition-all ${
                isSelected
                    ? 'border-purple-600 bg-purple-50'
                    : 'hover:bg-purple-25 border-gray-200 bg-white hover:border-purple-300'
            }`}
        >
            <div style={{ height: spriteHeight }} className="flex w-20 items-center justify-center">
                <SpriteAnimator
                    sprite={spriteUrl}
                    width={40}
                    height={spriteHeight}
                    scale={1}
                    fps={6}
                    frameCount={3}
                    direction={'horizontal'}
                    shouldAnimate={true}
                    startFrame={0}
                />
            </div>
        </div>
    );
}

export default function AgentTab({ isActive, onSpawnAgent, onRemoveAgentFromMap, spawnedAgents }: AgentTabProps) {
    const [agentUrl, setAgentUrl] = useState('');
    const [agents, setAgents] = useState<ImportedAgent[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedSprites, setSelectedSprites] = useState<{ [key: string]: string }>({});

    const handleImportAgent = async () => {
        if (!agentUrl.trim()) {
            setError('Please enter a valid agent URL');
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const proxyResponse = await fetch('/api/agent-proxy', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ agentUrl })
            });

            if (!proxyResponse.ok) {
                const errorData = await proxyResponse.json();
                throw new Error(errorData.error || 'Failed to fetch agent card');
            }

            const { agentCard } = await proxyResponse.json();

            if (agents.some((agent) => agent.url === agentUrl)) {
                setError('This agent has already been imported');
                setIsLoading(false);
                return;
            }

            const newAgent = {
                url: agentUrl,
                card: agentCard,
                spriteUrl: SPRITE_OPTIONS[0].url, // Default to first sprite option
                spriteHeight: SPRITE_OPTIONS[0].height
            };

            setAgents([...agents, newAgent]);
            setSelectedSprites((prev) => ({
                ...prev,
                [agentUrl]: SPRITE_OPTIONS[0].url
            }));

            setAgentUrl('');
        } catch (err) {
            setError(`Failed to import agent: ${err instanceof Error ? err.message : 'Unknown error'}`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleRemoveAgent = (url: string) => {
        if (spawnedAgents.includes(url)) {
            onRemoveAgentFromMap(url);
        }
        setAgents(agents.filter((agent) => agent.url !== url));
    };

    const handleSpriteChange = (agentUrl: string, spriteUrl: string) => {
        const selectedSprite = SPRITE_OPTIONS.find((sprite) => sprite.url === spriteUrl);
        const spriteHeight = selectedSprite?.height || 40;

        setSelectedSprites((prev) => ({
            ...prev,
            [agentUrl]: spriteUrl
        }));
        setAgents(agents.map((agent) => (agent.url === agentUrl ? { ...agent, spriteUrl, spriteHeight } : agent)));
    };

    return (
        <BaseTabContent isActive={isActive} className="bg-white">
            <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-4 overflow-hidden p-4">
                <h3 className="mb-3 text-lg font-semibold text-black">Import Agent</h3>
                <div className="flex space-x-2">
                    <input
                        type="url"
                        autoFocus={true}
                        value={agentUrl}
                        onChange={(e) => setAgentUrl(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleImportAgent()}
                        placeholder="Agent Card JSON URL"
                        className="flex flex-1 rounded-md border border-[#cdd3de] bg-[#f2f4f5] px-3 py-2 text-black placeholder:text-[#C6CDD5]"
                        disabled={isLoading}
                    />
                    <button
                        onClick={handleImportAgent}
                        disabled={isLoading || !agentUrl.trim()}
                        className="rounded-md bg-purple-600 px-4 py-2 text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                    >
                        {isLoading ? 'Importing...' : 'Import'}
                    </button>
                </div>
                {error && <div className="mt-2 text-sm text-red-600">⚠️ {error}</div>}
                <div className="inline-flex flex-col justify-start gap-2 self-stretch">
                    <p className="text-left text-sm text-[#838d9d]">Example Agent</p>
                    <div className="flex w-full flex-col items-start justify-start gap-2 rounded bg-[#faf4fe] px-2.5 py-2 outline-1 outline-offset-[-1px] outline-[#d7c1e5]">
                        <div className="inline-flex items-center justify-between gap-2 self-stretch">
                            <p className="flex-1 justify-start truncate text-sm text-[#b58dd2]">
                                https://a2a-agent-builder.vercel.app/api/agents/ryu-seong-ryong-1760653693783/.well-known/agent.json
                            </p>
                            <button
                                onClick={() =>
                                    navigator.clipboard.writeText(
                                        'https://a2a-agent-builder.vercel.app/api/agents/ryu-seong-ryong-1760653693783/.well-known/agent.json'
                                    )
                                }
                                className="flex cursor-pointer items-center justify-center gap-1 rounded bg-white px-3 py-2 outline-1 outline-[#cdd4de]"
                            >
                                <Image src="/agent/copy.svg" alt="Copy" width={16} height={16} />
                                <p className="justify-start text-xs text-black">Copy Link</p>
                            </button>
                        </div>
                    </div>
                </div>
                <h3 className="mt-2 text-lg font-semibold text-black">Imported Agents ({agents.length})</h3>
                <div className="flex-1 overflow-auto">
                    {agents.length === 0 ? (
                        <div className="inline-flex h-[150px] w-full flex-col items-center justify-center gap-3.5 rounded-lg bg-[#eff1f4] p-3.5">
                            <p className="justify-start self-stretch text-center font-['SF_Pro'] text-base text-[#838d9d]">
                                No agent imported Yet.
                                <br />
                                Copy a Example agent or Create one using the Agent Builder button.
                            </p>
                            <a
                                target="_blank"
                                href="https://a2a-agent-builder-alb7.vercel.app"
                                className="inline-flex h-9 items-center justify-center gap-2.5 rounded bg-[#7f4fe8] px-3 py-2"
                            >
                                <p className="justify-start font-['SF_Pro'] text-sm text-white">Agent Builder</p>
                            </a>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {agents.map((agent, index) => (
                                <div
                                    key={agent.url}
                                    className="overflow-hidden rounded-lg border border-gray-200 bg-white p-4"
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <h4 className="mb-2 font-semibold text-gray-900">
                                                {agent.card.name || `Agent ${index + 1}`}
                                            </h4>
                                            {agent.card.description && (
                                                <p className="mb-3 text-sm break-words text-[#838d9d]">
                                                    {agent.card.description}
                                                </p>
                                            )}
                                            <div className="mb-3">
                                                <p className="mb-2 text-xs font-medium text-[#838d9d]">
                                                    Select Character Sprite:
                                                </p>
                                                <div className="flex gap-2">
                                                    {SPRITE_OPTIONS.map((sprite) => (
                                                        <SpritePreview
                                                            key={sprite.url}
                                                            spriteUrl={sprite.url}
                                                            spriteHeight={sprite.height}
                                                            isSelected={
                                                                (selectedSprites[agent.url] ||
                                                                    agent.spriteUrl ||
                                                                    SPRITE_OPTIONS[0].url) === sprite.url
                                                            }
                                                            onClick={() => handleSpriteChange(agent.url, sprite.url)}
                                                        />
                                                    ))}
                                                </div>
                                            </div>
                                            <div className="flex items-center justify-between gap-3">
                                                <button
                                                    onClick={() => onSpawnAgent(agent)}
                                                    className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-medium text-white transition-all hover:bg-purple-700 active:scale-95"
                                                >
                                                    <Image
                                                        src="/agent/map-pin.svg"
                                                        alt="Add to Map"
                                                        width={16}
                                                        height={16}
                                                        className="brightness-0 invert"
                                                    />
                                                    <span>Add to Map</span>
                                                </button>
                                                <button
                                                    onClick={() => handleRemoveAgent(agent.url)}
                                                    className="flex h-10 items-center justify-center rounded-lg border-2 border-red-200 bg-white p-2.5 transition-all hover:border-red-400 hover:bg-red-50 active:scale-95"
                                                    title="Delete Agent"
                                                >
                                                    <Trash2Icon className="h-4 w-4" color="#fecaca" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </BaseTabContent>
    );
}
