'use client';

import React, { useCallback, useEffect, useState } from 'react';
import BaseTabContent from './BaseTabContent';
import { useAccount } from 'wagmi';
import ImportAgentSection from '@/components/agent-builder/ImportAgentSection';
import { StoredAgent } from '@/lib/redis';
import { MAP_NAMES, MAP_ZONES } from '@/constants/game';
import CreateAgentSection from '@/components/agent-builder/CreateAgentSection';
import ImportedAgentList from '@/components/agent-builder/ImportedAgentList';
import { useAgentStore, useUIStore } from '@/stores';
import LoadingModal from '../LoadingModal';
import HolderModal from '../HolderModal';
import { Address } from 'viem';
import { checkIsHolder, HolderCheckerContract } from '@/lib/holder-checker/api';

interface AgentTabProps {
    isActive: boolean;
    spawnedAgents: string[];
    isPositionValid: (x: number, y: number) => boolean;
    findAvailableSpawnPositionByZone: (zone: { startX: number; startY: number; endX: number; endY: number }) => { x: number; y: number } | null;
}

export default function AgentTab({
    isActive,
    isPositionValid,
    findAvailableSpawnPositionByZone,
}: AgentTabProps) {
    const [agents, setAgents] = useState<StoredAgent[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isHolderModalOpen, setIsHolderModalOpen] = useState<boolean>(false);

    const { address } = useAccount();
    const { spawnAgent: spawnAgentToStore, updateAgent } = useAgentStore();
    const { setActiveTab } = useUIStore();

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
        const contracts: HolderCheckerContract[] = [
                {       
                    chain: "Ethereum",      //eth AIN
                    standard: "erc20",
                    address: "0x3A810ff7211b40c4fA76205a14efe161615d0385",
                    source: "onchain"
                }, 
                {   
                    chain: "Base",          //base AIN
                    standard: "erc20",
                    address: "0xD4423795fd904D9B87554940a95FB7016f172773",
                    source: "onchain"
                },
                {
                    chain: "Base",      //base sAIN
                    standard: "erc20",
                    address: "0x70e68AF68933D976565B1882D80708244E0C4fe9",
            		    source: "onchain" 
                },
                {
                    chain: "Ethereum",      //mini egg nft
                    standard: "erc1155",
                    address: "0x495f947276749Ce646f68AC8c248420045cb7b5e",
                    source: "opensea",
                    collection: "mysterious-minieggs"
                }
            ]
        try {
            setIsLoading(true);
            const result = await checkIsHolder(userAddress, contracts);
            const isHolder = result.results.some((value: { isHolder: boolean; }) => value.isHolder === true)
            
            setIsLoading(false)
            return isHolder
        } catch (error) {
            console.error("isHolder API Error", error)
            setIsLoading(false)
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

    const handleSpawnAgent = useCallback(async (agent: StoredAgent, selectedMap?: MAP_NAMES) => {
        const agentId = `a2a-${Date.now()}`;
        const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8'];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];

        const spawnZone = selectedMap ? MAP_ZONES[selectedMap] : { startX: 50, startY: 60, endX: 70, endY: 80 };

        const spawnPosition = findAvailableSpawnPositionByZone(spawnZone);
        if (!spawnPosition) {
            console.error(`Cannot spawn agent: no available positions found in ${selectedMap || 'default'} zone`);
            setError(`Cannot spawn agent: no available space found in ${selectedMap || 'deployment'} zone. Please remove some agents or clear space on the map.`);
            return false;
        }
        const { x: spawnX, y: spawnY } = spawnPosition;
        console.log(`✓ Spawning agent at (${spawnX}, ${spawnY}) in ${selectedMap || 'default'} zone`);

        // Register agent with backend Redis
        try {
            if (!address) {
                throw new Error('Address is not connected');
            }
            const registerResponse = await fetch('/api/agents', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    url: agent.url,
                    creator: address,
                    state: {
                        x: spawnX,
                        y: spawnY,
                        behavior: 'random',
                        color: randomColor,
                        moveInterval: 600 + Math.random() * 400
                    },
                    isPlaced: true,
                    mapName: selectedMap,
                }),
            });

            if (!registerResponse.ok && registerResponse.status !== 409) {
                const errorData = await registerResponse.json();
                console.error('Failed to register agent with backend:', errorData);
                setError(errorData.error || 'Failed to place agent');
                return false;
            } else {
                console.log('✓ Agent registered with backend Redis');
            }
        } catch (err) {
            console.error('Error registering agent with backend:', err);
            setError('Failed to place agent. Please try again.');
            return false;
        }

        // Add to spawned A2A agents for UI tracking
        spawnAgentToStore({
            id: agentId,
            name: agent.card.name,
            x: spawnX,
            y: spawnY,
            color: agent.state.color,
            agentUrl: agent.url,
            behavior: 'random',
            lastMoved: Date.now(),
            moveInterval: agent.state.moveInterval || 600 + Math.random() * 400,
            skills: agent.card.skills || [],
            spriteUrl: agent.spriteUrl,
            spriteHeight: agent.spriteHeight || 50
        });

        // Switch to map tab
        setActiveTab('map');
        return true;
    }, [address, findAvailableSpawnPositionByZone, spawnAgentToStore, setActiveTab]);

    const handlePlaceAgent = async (agent: StoredAgent, selectedMap?: MAP_NAMES) => {
        setIsLoading(true);
        setError(null);
        const result = await handleSpawnAgent(agent, selectedMap);
        if (result) {
            setAgents(agents.map((a) => (a.url === agent.url ? { ...a, isPlaced: true } : a)));
        }
        setIsLoading(false);
    }

    const handleUnplaceAgent = async (agent: StoredAgent) => {
        setIsLoading(true);
        setError(null);

        try {
            const removeResponse = await fetch('/api/agents', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    url: agent.url,
                    isPlaced: false,
                }),
            });

            if (removeResponse.ok) {
                console.log('✓ Agent removed from map');
                // Remove from agent store
                const { removeAgent } = useAgentStore.getState();
                removeAgent(agent.url);
                // Update local state
                setAgents(agents.map((a) => (a.url === agent.url ? { ...a, isPlaced: false } : a)));
            } else {
                const errorData = await removeResponse.json();
                console.error('Failed to remove agent from map:', errorData);
                setError(errorData.error || 'Failed to remove agent from map');
            }
        } catch (err) {
            console.error('Error removing agent from map:', err);
            setError('Failed to remove agent from map. Please try again.');
        }

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
