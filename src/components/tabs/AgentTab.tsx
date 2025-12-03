'use client';

import React, { useEffect, useState } from 'react';
import { SpriteAnimator } from 'react-sprite-animator';
import BaseTabContent from './BaseTabContent';
import { useAccount } from 'wagmi';
import ImportAgentSection from '@/components/agent-builder/ImportAgentSection';
import { StoredAgent } from '@/lib/redis';
import CreateAgentSection from '@/components/agent-builder/CreateAgentSection';
import ImportedAgentList from '@/components/agent-builder/ImportedAgentList';

interface AgentTabProps {
    isActive: boolean;
    onSpawnAgent: (agent: StoredAgent) => void;
    onRemoveAgentFromMap: (agentUrl: string) => void;
    spawnedAgents: string[];
}

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
            className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 p-1 transition-all ${
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

export default function AgentTab({
    isActive,
    onSpawnAgent,
    onRemoveAgentFromMap,
}: AgentTabProps) {
    const [agents, setAgents] = useState<StoredAgent[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { address } = useAccount();

    useEffect(() => {
        const fetchAgent = async () => {
            const result = await fetch(`/api/agents?address=${address}`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            })
            if (result.ok) {
                const agentsData = await result.json();
                setAgents(agentsData.agents)
            }
        }
        try {
            fetchAgent()
        } catch (error) {
            console.log(error)
        }
    }, [address])

    const handleImportAgent = async (agentUrl: string) => {
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

            const newAgent: StoredAgent = {
                url: agentUrl,
                card: agentCard,
                isPlaced: false,
                creator: address!,
                timestamp: Date.now(),
                state: {
                    x: 0,
                    y: 0,
                    behavior: 'random',
                    color: '#ffffff',
                    moveInterval: 600 + Math.random() * 400
                }
            };

            setAgents([newAgent, ...agents]);

            await fetch('/api/agents', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(newAgent)
            });
        } catch (err) {
            setError(`Failed to import agent: ${err instanceof Error ? err.message : 'Unknown error'}`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleRemoveAgent = async (url: string) => {
        const response = await fetch('/api/agents?url=' + url, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
        });
        if (response.ok) {
            const result = await response.json();
            if (result.success) {
                setAgents(agents.filter((agent) => agent.url !== url));
                return;
            }
        } else {
            setError('Failed to remove agent');
        }
    };

    const handlePlaceAgent = async (agent: StoredAgent) => {
      await onSpawnAgent(agent);
      setAgents(agents.map((a) => (a.url === agent.url ? { ...a, isPlaced: true } : a)));
    }

    const handleUnplaceAgent = async (agent: StoredAgent) => {
      await onRemoveAgentFromMap(agent.url);
      setAgents(agents.map((a) => (a.url === agent.url ? { ...a, isPlaced: false } : a)));
    }

    const handleUploadImage = async (agent: StoredAgent, sprite: string | File) => {
        let response: Response | null = null;
        const isFile = sprite instanceof File;
        if (!isFile) {
            response = await fetch('/api/agents', {
                method: 'PUT',
                body: JSON.stringify({
                    url: agent.url,
                    spriteUrl: sprite,
                }),
            });
        } else {
            const formData = new FormData();
            formData.append('image', sprite);
            formData.append('agentUrl', agent.url);
            response = await fetch('/api/agents/upload-image', {
                method: 'POST',
                body: formData,
            });
        }
        if (response && response.ok) {
            const result = await response.json();
            setAgents(agents.map((a) => {
              const newSpriteUrl = isFile ? result.spriteUrl : sprite as string;
              if (a.url === agent.url) {
                console.log('Image Changed!: ', a.card.name, a.spriteUrl, newSpriteUrl);
                return { ...a, spriteUrl: newSpriteUrl };
              }
              return a;
            }));
        }
    }

    return (
        <BaseTabContent isActive={isActive} className="bg-white">
            <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-[30px] overflow-auto">
                <div className="flex flex-col gap-4 px-5">
                    <p className="text-xl font-bold text-black text-center">Place your Agent to AINSpace</p>
                    <CreateAgentSection />
                    <ImportAgentSection handleImportAgent={handleImportAgent} isLoading={isLoading} />
                    {error && <div className="mt-2 text-sm text-red-600">⚠️ {error}</div>}
                </div>
                <ImportedAgentList
                    agents={agents}
                    onPlaceAgent={handlePlaceAgent}
                    onUnplaceAgent={handleUnplaceAgent}
                    onRemoveAgent={handleRemoveAgent}
                    onUploadImage={handleUploadImage}
                />
            </div>
        </BaseTabContent>
    );
}
