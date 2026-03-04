'use client';

import { cn } from '@/lib/utils';
import { AgentState } from '@/lib/agent';
import { AgentProfile } from '@/components/AgentProfile';

interface MentionSuggestionDropdownProps {
    agents: AgentState[];
    selectedIndex: number;
    onSelect: (agent: AgentState) => void;
}

export default function MentionSuggestionDropdown({ agents, selectedIndex, onSelect }: MentionSuggestionDropdownProps) {
    return (
        <div className="absolute right-3 bottom-full left-3 z-10 mb-1 max-h-32 overflow-y-auto rounded-md border border-gray-600 bg-gray-800 shadow-lg">
            {agents.map((agent, index) => {
                const isSelected = index === selectedIndex;

                return (
                    <button
                        key={agent.id}
                        onClick={() => onSelect(agent)}
                        className={cn(
                            'flex w-full items-center px-3 py-2 text-left text-sm focus:outline-none',
                            isSelected ? 'bg-blue-600 text-white' : 'text-gray-200 hover:bg-gray-700'
                        )}
                    >
                        <div className="flex items-center">
                            <div className="mr-2">
                                <AgentProfile width={20} height={20} imageUrl={agent.spriteUrl} backgroundColor="transparent" />
                            </div>
                            <span className="font-medium">{agent.name}</span>
                        </div>
                    </button>
                );
            })}
        </div>
    );
}
