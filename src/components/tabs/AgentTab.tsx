'use client';

import React, { useEffect, useState } from 'react';
import BaseTabContent from './BaseTabContent';
import { useAccount } from 'wagmi';
import ImportAgentSection from '@/components/agent-builder/ImportAgentSection';
import { StoredAgent } from '@/lib/redis';
import CreateAgentSection from '@/components/agent-builder/CreateAgentSection';
import ImportedAgentList from '@/components/agent-builder/ImportedAgentList';
import { useAgentStore, useUIStore, useUserStore, useUserAgentStore } from '@/stores';
import LoadingModal from '../LoadingModal';
import HolderModal from '../HolderModal';

interface AgentTabProps {
    isActive: boolean;
}

export default function AgentTab({
    isActive,
}: AgentTabProps) {
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [isHolderModalOpen, setIsHolderModalOpen] = useState<boolean>(false);

    const { address } = useAccount();
    const { updateAgent } = useAgentStore();
    const { setActiveTab, setSelectedAgentForPlacement } = useUIStore();
    const { checkPermission, verifyPermissions, permissions } = useUserStore();
    const {
        agents,
        setAgents,
        addAgent,
        updateAgent: updateStoredAgent,
        removeAgent: removeStoredAgent,
    } = useUserAgentStore();

    useEffect(() => {
        const fetchAgent = async () => {
            try {
                const result = await fetch(`/api/agents?address=${address}`, {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' }
                })
                if (result.ok) {
                    const agentsData = await result.json();
                    setAgents(agentsData.agents);
                }
            } catch (error) {
                console.log(error);
            }
        }
        fetchAgent();
    }, [address, setAgents])

    const handleImportAgent = async (agentUrl: string) => {
        if (!address) {
            setError("Wallet connection has been disconnected. Please reconnect wallet.")
            return;
        }
        if (!agentUrl.trim()) {
            setError('Please enter a valid agent URL');
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            // Step 1: Check permission from store
            const hasPermission = checkPermission('importAgent');

            if (!hasPermission) {
                console.log('No import permission, attempting to verify...');
                // Step 2: Re-verify permissions (with cooldown)
                const verifyResult = await verifyPermissions(address);

                if (!verifyResult.success || !verifyResult.permissions?.permissions.importAgent) {
                    console.log('Verification failed or still no permission');
                    setIsHolderModalOpen(true);
                    setIsLoading(false);
                    return;
                }
                console.log('Permission verified successfully');
            }

            // Step 3: Proceed with import
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

            // Step 4: Call API (server-side validation)
            const response = await fetch('/api/agents', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(newAgent)
            });

            // If API returns 403, force re-verify (no cooldown)
            if (response.status === 403) {
                const errorData = await response.json();
                console.error('API permission denied:', errorData);

                // Force re-verify by calling API directly
                const forceVerifyResult = await verifyPermissions(address);

                if (!forceVerifyResult.success || !forceVerifyResult.permissions?.permissions.importAgent) {
                    setIsHolderModalOpen(true);
                } else {
                    setError('Permission verification updated. Please try again.');
                }
                setIsLoading(false);
                return;
            }

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to import agent');
            }

            addAgent(newAgent);
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
                removeStoredAgent(url);
            }
        } else {
            setError('Failed to remove agent');
        }
        setIsLoading(false);
    };

    const handlePlaceAgent = async (agent: StoredAgent) => {
        if (!address) {
            setError('Wallet connection has been disconnected. Please reconnect wallet.');
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            // Step 1: Check permission from store
            const hasPermission = checkPermission('placeAgent');

            if (!hasPermission) {
                console.log('No place permission, attempting to verify...');
                // Step 2: Re-verify permissions (with cooldown)
                const verifyResult = await verifyPermissions(address);

                if (!verifyResult.success || !verifyResult.permissions?.permissions.placeAgent) {
                    console.log('Verification failed or still no permission');
                    setIsHolderModalOpen(true);
                    setIsLoading(false);
                    return;
                }
                console.log('Permission verified successfully');
            }

            // Step 3: Get allowed maps from permissions
            const allowedMaps = permissions?.permissions.placeAllowedMaps || [];
            if (allowedMaps.length === 0) {
                setError("You don't have permission to place agents on any map");
                setIsLoading(false);
                return;
            }

            // Step 4: Activate placement mode - switch to map with all allowed maps
            setSelectedAgentForPlacement({
                agent: agent,
                allowedMaps: allowedMaps
            });
            setActiveTab('map');
        } catch (err) {
            setError(`Failed to activate placement mode: ${err instanceof Error ? err.message : 'Unknown error'}`);
        } finally {
            setIsLoading(false);
        }
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
                const { removeAgent } = useAgentStore.getState();
                removeAgent(agent.url);
                updateStoredAgent(agent.url, { isPlaced: false });
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
                    const updatedAgentData = { spriteUrl: result.agent.spriteUrl, spriteHeight: result.agent.spriteHeight };
                    console.log('Image Changed!: ', agent.card.name, agent.spriteUrl, result.agent.spriteUrl, result.agent.spriteHeight);
                    updateStoredAgent(agent.url, updatedAgentData);
                    updateAgent(agent.url, updatedAgentData);
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
                const updatedAgentData = { spriteUrl: result.spriteUrl, spriteHeight: result.spriteHeight };
                updateStoredAgent(agent.url, updatedAgentData);
                updateAgent(agent.url, updatedAgentData);
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
