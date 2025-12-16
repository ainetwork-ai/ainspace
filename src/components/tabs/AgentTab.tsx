'use client';

import React, { useEffect, useState } from 'react';
import BaseTabContent from './BaseTabContent';
import { useAccount } from 'wagmi';
import ImportAgentSection from '@/components/agent-builder/ImportAgentSection';
import { StoredAgent } from '@/lib/redis';
import CreateAgentSection from '@/components/agent-builder/CreateAgentSection';
import ImportedAgentList from '@/components/agent-builder/ImportedAgentList';
import { useAgentStore } from '@/stores';
import LoadingModal from '../LoadingModal';
import HolderModal from '../HolderModal';
import { Address } from 'viem';

interface AgentTabProps {
    isActive: boolean;
    onSpawnAgent: (agent: StoredAgent) => Promise<boolean>;
    onRemoveAgentFromMap: (agentUrl: string) => void;
    spawnedAgents: string[];
}

export default function AgentTab({
    isActive,
    onSpawnAgent,
    onRemoveAgentFromMap,
}: AgentTabProps) {
    const [agents, setAgents] = useState<StoredAgent[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isHolderModalOpen, setIsHolderModalOpen] = useState<boolean>(false);
    const { address } = useAccount();
    const { updateAgent } = useAgentStore();

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

    const checkHolderStatus = async (userAddress: Address) => {
        const requestBody = {
            walletAddress: userAddress,
            //TODO (chanho): 컨트랙트 추가 필요 (erc1155, 그 외 홀더 체크 필요한 토큰들)
            // 이외에 다른 곳에서도 사용된다면 공용 함수로 refactoring 고려
            contracts: [
                {
                    chain: "ethereum",
                    standard: "erc20",
                    address: "0x3A810ff7211b40c4fA76205a14efe161615d0385"
                }, 
                {
                    chain: "base",
                    standard: "erc20",
                    address: "0xD4423795fd904D9B87554940a95FB7016f172773"
                },
            ]
        }
        try {
            const data = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/api/token/balance`, {
                method: 'POST',
                body: JSON.stringify(requestBody),
                headers: {
                    'Content-Type': 'application/json'
                },
            })
            const result = await data.json()
            const isHolder = result.results.some((value: { isHolder: boolean; }) => value.isHolder === true)
            
            return isHolder
        } catch (error) {
            console.error("isHolder API Error", error)
        }
        
    }

    const handleImportAgent = async (agentUrl: string) => {
        if (!address) {
            setError("Wallet connection has been disconnected. Please reconnect wallet.")
            return;
        }
        const isHolder = await checkHolderStatus(address)
        if (!isHolder) {
            setIsHolderModalOpen(true) 
            return;
        }
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
        setIsLoading(true);
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
            }
        } else {
            setError('Failed to remove agent');
        }
        setIsLoading(false);
    };

    const handlePlaceAgent = async (agent: StoredAgent) => {
        setIsLoading(true);
        const result = await onSpawnAgent(agent);
        if (result) {
            setAgents(agents.map((a) => (a.url === agent.url ? { ...a, isPlaced: true } : a)));
        } else {
            setError('Failed to place agent');
        }
        setIsLoading(false);
    }

    const handleUnplaceAgent = async (agent: StoredAgent) => {
        setIsLoading(true);
        await onRemoveAgentFromMap(agent.url);
        setAgents(agents.map((a) => (a.url === agent.url ? { ...a, isPlaced: false } : a)));
        setIsLoading(false);
    }

    const handleUploadImage = async (agent: StoredAgent, sprite: {url: string, height: number} | File) => {
        let response: Response | null = null;
        const isFile = sprite instanceof File;
        setIsLoading(true);
        if (!isFile) {
            response = await fetch('/api/agents', {
                method: 'PUT',
                body: JSON.stringify({
                    url: agent.url,
                    spriteUrl: sprite.url,
                    spriteHeight: sprite.height,
                }),
            });
            if (response && response.ok) {
                const result = await response.json();
                if (result.success) {
                    const updatedAgent = { spriteUrl: result.agent.spriteUrl, spriteHeight: result.agent.spriteHeight };
                    setAgents(agents.map((a) => {
                        if (a.url === agent.url) {
                            console.log('Image Changed!: ', a.card.name, a.spriteUrl, result.agent.spriteUrl, result.agent.spriteHeight);
                            return { ...a, ...updatedAgent };
                        }
                        return a;
                    }));
                    
                    updateAgent(agent.url, updatedAgent);
                }
            }
        } else {
            const formData = new FormData();
            formData.append('image', sprite as File);
            formData.append('agentUrl', agent.url);
            response = await fetch('/api/agents/upload-image', {
                method: 'POST',
                body: formData,
            });
            if (response && response.ok) {
                const result = await response.json();
                const updatedAgent = { spriteUrl: result.spriteUrl, spriteHeight: result.spriteHeight };
                
                setAgents(agents.map((a) => {
                  if (a.url === agent.url) {
                    return { ...a, ...updatedAgent };
                  }
                  return a;
                }));
                
                updateAgent(agent.url, updatedAgent);
            }
        }
        setIsLoading(false);
    }

    return (
        <BaseTabContent isActive={isActive} className="bg-white">
            <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-[30px] overflow-y-auto overflow-x-hidden font-manrope min-h-0">
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
            <LoadingModal open={isLoading} />
            <HolderModal open={isHolderModalOpen} onOpenChange={setIsHolderModalOpen}/>
        </BaseTabContent>
    );
}
