'use client';

import Image from 'next/image';
import React, { useState } from 'react';
import { AgentCard } from '@a2a-js/sdk';
import BaseTabContent from './BaseTabContent';
import Link from 'next/link';

interface ImportedAgent {
    url: string;
    card: AgentCard;
    characterImage?: string; // Character image URL for layer2
}

interface AgentTabProps {
    isActive: boolean;
    onSpawnAgent: (agent: ImportedAgent) => void;
    onRemoveAgentFromMap: (agentUrl: string) => void;
    spawnedAgents: string[]; // URLs of spawned agents
    onUploadCharacterImage: (agentUrl: string, imageUrl: string) => void;
}

export default function AgentTab({
    isActive,
    onSpawnAgent,
    onRemoveAgentFromMap,
    spawnedAgents,
    onUploadCharacterImage
}: AgentTabProps) {
    const [agentUrl, setAgentUrl] = useState('');
    const [agents, setAgents] = useState<ImportedAgent[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [uploadingImage, setUploadingImage] = useState<string | null>(null);

    const handleImportAgent = async () => {
        if (!agentUrl.trim()) {
            setError('Please enter a valid agent URL');
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            // Use proxy to fetch agent card to avoid CORS issues
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

            // Check if agent already exists
            if (agents.some((agent) => agent.url === agentUrl)) {
                setError('This agent has already been imported');
                setIsLoading(false);
                return;
            }

            // Add the agent to the list
            setAgents([
                ...agents,
                {
                    url: agentUrl,
                    card: agentCard
                }
            ]);

            // Clear the input
            setAgentUrl('');
        } catch (err) {
            setError(`Failed to import agent: ${err instanceof Error ? err.message : 'Unknown error'}`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleRemoveAgent = (url: string) => {
        setAgents(agents.filter((agent) => agent.url !== url));
    };

    const handleImageUpload = async (agentUrl: string, file: File) => {
        setUploadingImage(agentUrl);
        try {
            // Upload to Vercel Blob
            const formData = new FormData();
            const imageId = `character_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            formData.append('file', file, `${imageId}.png`);
            formData.append('tileId', imageId);

            const uploadResponse = await fetch('/api/upload-tile', {
                method: 'POST',
                body: formData
            });

            if (!uploadResponse.ok) {
                throw new Error('Failed to upload image');
            }

            const { url } = await uploadResponse.json();

            // Update agent with character image
            setAgents(agents.map((agent) => (agent.url === agentUrl ? { ...agent, characterImage: url } : agent)));

            // Notify parent component
            onUploadCharacterImage(agentUrl, url);
        } catch (err) {
            setError(`Failed to upload image: ${err instanceof Error ? err.message : 'Unknown error'}`);
        } finally {
            setUploadingImage(null);
        }
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
                                    className="overflow-hidden rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <h4 className="font-semibold text-gray-900">
                                                {agent.card.name || `Agent ${index + 1}`}
                                            </h4>
                                            {agent.card.description && (
                                                <p className="mt-1 text-sm break-words text-gray-600">
                                                    {agent.card.description}
                                                </p>
                                            )}
                                            <div className="mt-2 space-y-1 text-xs text-gray-500">
                                                <div>Version: {agent.card.version || 'N/A'}</div>
                                                <div>Protocol: {agent.card.protocolVersion || 'N/A'}</div>
                                                <div>
                                                    URL: <span className="break-all text-blue-600">{agent.url}</span>
                                                </div>
                                                {agent.card.capabilities?.streaming && (
                                                    <div className="text-green-600">✓ Streaming supported</div>
                                                )}
                                            </div>

                                            {/* Skills */}
                                            {agent.card.skills && agent.card.skills.length > 0 && (
                                                <div className="mt-3">
                                                    <div className="mb-1 text-xs font-medium text-gray-700">
                                                        Skills:
                                                    </div>
                                                    <div className="flex flex-wrap gap-1">
                                                        {agent.card.skills.map((skill, skillIndex) => (
                                                            <span
                                                                key={skillIndex}
                                                                className="inline-block rounded-full bg-purple-100 px-2 py-1 text-xs text-purple-700"
                                                            >
                                                                {skill.name}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        <div className="ml-4 flex flex-col space-y-2">
                                            <div className="flex space-x-2">
                                                {spawnedAgents.includes(agent.url) ? (
                                                    <button
                                                        onClick={() => onRemoveAgentFromMap(agent.url)}
                                                        className="rounded bg-red-500 px-3 py-1 text-xs text-white transition-colors hover:bg-red-600"
                                                        title="Remove from map"
                                                    >
                                                        Remove from Map
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => onSpawnAgent(agent)}
                                                        className="rounded bg-green-500 px-3 py-1 text-xs text-white transition-colors hover:bg-green-600"
                                                        title="Spawn on map"
                                                    >
                                                        Spawn on Map
                                                    </button>
                                                )}

                                                <button
                                                    onClick={() => handleRemoveAgent(agent.url)}
                                                    className="text-red-500 transition-colors hover:text-red-700"
                                                    title="Remove agent completely"
                                                >
                                                    ✕
                                                </button>
                                            </div>

                                            {/* Character Image Upload */}
                                            <div className="flex flex-col space-y-1">
                                                <label className="text-xs text-gray-600">Character Image:</label>
                                                {agent.characterImage ? (
                                                    <div className="flex items-center space-x-2">
                                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                                        <img
                                                            src={agent.characterImage}
                                                            alt="Character"
                                                            className="h-8 w-8 rounded border object-cover"
                                                        />
                                                        <label className="cursor-pointer rounded bg-blue-500 px-2 py-1 text-xs text-white transition-colors hover:bg-blue-600">
                                                            Change
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
                                                    <label className="cursor-pointer rounded bg-purple-500 px-2 py-1 text-center text-xs text-white transition-colors hover:bg-purple-600">
                                                        {uploadingImage === agent.url ? 'Uploading...' : 'Upload Image'}
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
                                                )}
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
