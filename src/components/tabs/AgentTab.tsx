'use client';

import Image from 'next/image';
import React, { useState } from 'react';
import { AgentCard } from '@a2a-js/sdk';
import BaseTabContent from './BaseTabContent';

interface ImportedAgent {
    url: string;
    card: AgentCard;
    characterImage?: string;
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

export default function AgentTab({
    isActive,
    onSpawnAgent,
    onRemoveAgentFromMap,
    spawnedAgents
}: AgentTabProps) {
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
        setAgents(
            agents.map((agent) => (agent.url === agentUrl ? { ...agent, spriteUrl, spriteHeight } : agent))
        );
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
                        onKeyPress={(e) => e.key === 'Enter' && handleImportAgent()}
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
                                href="https://a2a-agent-builder-git-main-comcom-team.vercel.app?_vercel_share=0qHZq7N3C1Au0tZ4cCrduC8zMNEspwOi"
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
                                            <div className="inline-flex items-start justify-start gap-2">
                                                {agent.characterImage ? (
                                                    <div className="relative flex items-center space-x-2">
                                                        <label
                                                            className={`cursor-pointer text-xs text-white transition-colors ${uploadingImage === agent.url ? 'pointer-events-none' : ''}`}
                                                        >
                                                            <Image
                                                                src={agent.characterImage}
                                                                className={`rounded-md ${uploadingImage === agent.url ? 'opacity-50' : ''}`}
                                                                alt="agent"
                                                                width={48}
                                                                height={48}
                                                            />
                                                            {uploadingImage === agent.url && (
                                                                <div className="absolute inset-0 flex items-center justify-center">
                                                                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-purple-600"></div>
                                                                </div>
                                                            )}
                                                            <input
                                                                type="file"
                                                                accept="image/*"
                                                                className="hidden"
                                                                onChange={(e) => {
                                                                    const file = e.target.files?.[0];
                                                                    if (file) handleImageUpload(agent.url, file);
                                                                }}
                                                                disabled={uploadingImage === agent.url}
                                                            />
                                                        </label>
                                                    </div>
                                                ) : (
                                                    <div className="relative">
                                                        <Image
                                                            src="/agent/defaultAvatar.svg"
                                                            alt="agent"
                                                            width={48}
                                                            height={48}
                                                            className={uploadingImage === agent.url ? 'opacity-50' : ''}
                                                        />
                                                        {uploadingImage === agent.url && (
                                                            <div className="absolute inset-0 flex items-center justify-center">
                                                                <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-purple-600"></div>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                                <label
                                                    className={`cursor-pointer ${uploadingImage === agent.url ? 'pointer-events-none' : ''}`}
                                                >
                                                    <div
                                                        className={`ml-5 flex h-[30px] items-center justify-center gap-1 rounded px-1.5 ${uploadingImage === agent.url ? 'bg-gray-200' : 'bg-[#ebeef2]'}`}
                                                    >
                                                        <p className="justify-start font-['SF_Pro'] text-xs text-[#838d9d]">
                                                            {uploadingImage === agent.url
                                                                ? 'Uploading...'
                                                                : agent.characterImage
                                                                  ? 'Change Image'
                                                                  : 'Upload Image'}
                                                        </p>
                                                        {uploadingImage !== agent.url && (
                                                            <Image
                                                                src="/agent/image.svg"
                                                                alt="uploadImage"
                                                                width={12}
                                                                height={12}
                                                            />
                                                        )}
                                                    </div>
                                                    <input
                                                        type="file"
                                                        accept="image/*"
                                                        className="hidden"
                                                        onChange={(e) => {
                                                            const file = e.target.files?.[0];
                                                            if (file) handleImageUpload(agent.url, file);
                                                        }}
                                                        disabled={uploadingImage === agent.url}
                                                    />
                                                </label>
                                                <div className="relative">
                                                    <select
                                                        value={
                                                            selectedSprites[agent.url] ||
                                                            agent.spriteUrl ||
                                                            SPRITE_OPTIONS[0].url
                                                        }
                                                        onChange={(e) => handleSpriteChange(agent.url, e.target.value)}
                                                        className="flex h-[30px] cursor-pointer appearance-none items-center justify-start gap-1 rounded bg-[#ebeef2] px-1.5 pr-6 text-xs text-[#838d9d] outline-none"
                                                        style={{ paddingRight: '20px' }}
                                                    >
                                                        {SPRITE_OPTIONS.map((sprite) => (
                                                            <option key={sprite.url} value={sprite.url}>
                                                                {sprite.name}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <div className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2">
                                                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                                            <path
                                                                d="M3 5L6 8L9 5"
                                                                stroke="#838d9d"
                                                                strokeWidth="1.5"
                                                                strokeLinecap="round"
                                                                strokeLinejoin="round"
                                                            />
                                                        </svg>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => onSpawnAgent(agent)}
                                                    className="flex h-[30px] cursor-pointer items-center justify-start gap-1 rounded bg-[#ebeef2] px-1.5"
                                                >
                                                    <p className="justify-start font-['SF_Pro'] text-xs text-[#838d9d]">
                                                        Add to Map
                                                    </p>
                                                    <Image
                                                        src="/agent/map-pin.svg"
                                                        alt="uploadImage"
                                                        width={12}
                                                        height={12}
                                                    />
                                                </button>
                                                <button
                                                    className="cursor-pointer"
                                                    onClick={() => handleRemoveAgent(agent.url)}
                                                >
                                                    <Image
                                                        src="/agent/trash.svg"
                                                        alt="uploadImage"
                                                        width={30}
                                                        height={30}
                                                    />
                                                </button>
                                            </div>
                                            <h4 className="font-semibold text-gray-900">
                                                {agent.card.name || `Agent ${index + 1}`}
                                            </h4>
                                            {agent.card.description && (
                                                <p className="mt-2 text-sm break-words text-[#838d9d]">
                                                    {agent.card.description}
                                                </p>
                                            )}
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
