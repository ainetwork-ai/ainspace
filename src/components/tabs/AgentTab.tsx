'use client';

import Image from 'next/image';
import React, { useEffect, useState } from 'react';
import { AgentCard } from '@a2a-js/sdk';
import { SpriteAnimator } from 'react-sprite-animator';
import BaseTabContent from './BaseTabContent';
import { CameraIcon, Trash2Icon, User } from 'lucide-react';
import { useAccount } from 'wagmi';
import Button from '../ui/Button';

interface ImportedAgent {
    url?: string;
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

function NoAgentNotice() {
    return (
        <div className="inline-flex h-[150px] w-full flex-col items-center justify-center gap-3.5 rounded-lg bg-[#eff1f4] p-3.5">
            <p className="justify-start self-stretch text-center font-['SF_Pro'] text-base text-[#838d9d]">
                No agent imported yet.
                <br />
                Import from URL or create with AI above.
            </p>
        </div>
    )
}

function ImportAgent({
    handleImportAgent,
    isLoading
}: {
    handleImportAgent: (agentUrl: string) => void;
    isLoading: boolean;
}) {
    const [agentUrl, setAgentUrl] = useState<string>('');

    const handleImportAgentClick = () => {
        handleImportAgent(agentUrl);
        setAgentUrl('');
    }

    return (
        <div className='flex flex-col gap-4 p-6 border border-[#E6EAEF] rounded-[8px] bg-white'>
            <h3 className="text-xl font-semibold text-black text-center">Use deployed Agent 👨‍👩‍👧‍👦</h3>
            <div className="flex flex-row gap-2">
                <input
                    type="url"
                    autoFocus={true}
                    value={agentUrl}
                    onChange={(e) => setAgentUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleImportAgentClick()}
                    placeholder="https://your.agent.url/.well-known/agent.json"
                    className="flex flex-1 min-w-0 rounded-sm border border-[#cdd3de] bg-[#f3f4f5] px-2.5 py-4 text-black placeholder:text-[#C6CDD5] placeholder:truncate"
                    disabled={isLoading} />
                <Button
                    onClick={handleImportAgentClick}
                    disabled={isLoading || !agentUrl.trim()}
                    type="large"
                >
                    {isLoading ? 'Importing...' : 'Import'}
                </Button>
            </div>
            <div className="flex flex-col gap-2 text-[#838D9D]">
                <p className="text-sm font-bold text-center">Agent Card URL Example</p>
                <p className="text-sm font-medium text-center">https://your.agent.url/.well-known/agent.json</p>
            </div>
            <p className="text-xs font-medium text-[#B78213] text-center">
                ⚠️Your agent must support <span className="text-[#7F4FE8] underline">A2A (Agent-to-Agent)</span>
            </p>
        </div>
    )
}

const CreateNewAgent = () => {
  const handleCreateAgent = async () => {
      window.open('https://a2a-agent-builder.vercel.app/', '_blank');
  }

  return (
      <div className='flex flex-col gap-4 p-6 border border-[#E6EAEF] rounded-[8px] bg-white'>
          <div className="flex flex-col gap-2">
              <p className="text-xl font-semibold text-black text-center">Create New Agent 🔮</p>
              <p className="text-sm font-medium text-center text-[#838D9D]">Generate AI Agent with A2A Builder</p>
          </div>
          <Button
              onClick={handleCreateAgent}
              type="large"
          >
              A2A Builder
          </Button>
      </div>
  )
}

function MyAgentCard({ agent }: { agent: ImportedAgent }) {
    const { url, card, spriteUrl, spriteHeight } = agent;
    const handleRemoveAgent = () => {
        console.log('remove agent', url);
    }
    return (
      <div className="flex flex-col gap-2 p-[14px] border border-[#E6EAEF] rounded-[8px]">
          <div className="flex flex-row justify-between">
              <div className="flex items-center justify-center w-12 h-12 rounded-lg overflow-hidden bg-[#F5F7FB]">
                  {
                      // spriteUrl ?
                          // <Image src={spriteUrl} alt={card.name} width={48} height={48} /> :
                          <User className="w-[35px] h-[35px] text-[#CAD0D7] fill-[#CAD0D7]" strokeWidth={0.7} />
                  }
              </div>
              <div className="flex flex-row gap-1">
                  <Button
                      onClick={() => console.log('edit agent', url)}
                      type="small"
                      variant={`${spriteUrl ? 'secondary' : 'primary'}`}
                      className="h-fit p-[9px] flex flex-row gap-1 items-center justify-center"
                  >
                      <CameraIcon className="w-4 h-4 text-white" type="icon" strokeWidth={1.3} />
                      <p className="text-sm font-medium text-white leading-none">Edit</p>
                  </Button>
                  <Button
                      onClick={handleRemoveAgent}
                      type="small"
                      variant="ghost"
                      className="h-fit p-[9px]"
                  >
                      <Trash2Icon className="w-4 h-4 text-[#969EAA]" type="icon" strokeWidth={1.3} />
                  </Button>
              </div>
          </div>
          <p className="text-black font-semibold text-sm">{card.name}</p>
          <p className="text-[#838D9D] font-medium text-sm line-clamp-4">{card.description}</p>
      </div>
    )
}

function MyAgentList({ agents }: { agents: ImportedAgent[] }) {
  return (
    <div className="flex flex-col gap-4 px-5 bg-white">
        <h3 className="text-xl font-semibold text-black text-center">My Agents ({agents.length})</h3>
        {agents.length === 0 ? (
          <NoAgentNotice/>
        ) : (
            agents.map((agent) => (
                <MyAgentCard key={agent.url} agent={agent} />
            ))
        )}
    </div>
  )
}

export default function AgentTab({ isActive, onSpawnAgent, onRemoveAgentFromMap, spawnedAgents }: AgentTabProps) {
    const [agents, setAgents] = useState<ImportedAgent[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedSprites, setSelectedSprites] = useState<{ [key: string]: string }>({});
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
    }, []) //NOTE(chanho): 이ㅣㄹ시적으로 에이전트 조회용 추후에 삭제 가능

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
            <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-[30px] overflow-auto">
                <div className="flex flex-col gap-4 px-5">
                    <p className="text-xl font-bold text-black text-center">Place your Agent to AINSpace</p>
                    <CreateNewAgent />
                    <ImportAgent handleImportAgent={handleImportAgent} isLoading={isLoading} />
                    {error && <div className="mt-2 text-sm text-red-600">⚠️ {error}</div>}
                </div>
                <MyAgentList agents={agents} />
            </div>
        </BaseTabContent>
    );
}
