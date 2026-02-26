'use client';

import Button from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { useState } from "react";

interface ImportAgentSectionProps {
    handleImportAgent: (agentUrl: string) => void;
    isLoading: boolean;
    isDarkMode?: boolean;
}

export default function ImportAgentSection({
    handleImportAgent,
    isLoading,
    isDarkMode = false,
}: ImportAgentSectionProps) {
    const [agentUrl, setAgentUrl] = useState<string>('');

    const handleImportAgentClick = () => {
        handleImportAgent(agentUrl);
        setAgentUrl('');
    }

    return (
        <div className={cn(
            'flex flex-col gap-4 p-6 border rounded-[8px]',
            isDarkMode
                ? 'bg-[#222529] border-[#4A4E56]'
                : 'bg-white border-[#E6EAEF]'
        )}>
            <h3 className={cn("text-xl font-semibold text-center", isDarkMode ? 'text-white' : 'text-black')}>Use deployed Agent 👨‍👩‍👧‍👦</h3>
            <div className="flex flex-row gap-2">
                <input
                    type="url"
                    value={agentUrl}
                    onChange={(e) => setAgentUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleImportAgentClick()}
                    placeholder="https://your.agent.url/.well-known/agent.json"
                    className={cn(
                        "flex flex-1 min-w-0 rounded-sm border px-2.5 py-4 placeholder:truncate",
                        isDarkMode
                            ? 'bg-[#1A1D22] border-[#4A4E56] text-white placeholder:text-[#838D9D]'
                            : 'bg-[#f3f4f5] border-[#cdd3de] text-black placeholder:text-[#C6CDD5]'
                    )}
                    disabled={isLoading} />
                <Button
                    onClick={handleImportAgentClick}
                    disabled={isLoading || !agentUrl.trim()}
                    type="large"
                    isDarkMode={isDarkMode}
                >
                    {isLoading ? 'Importing...' : 'Import'}
                </Button>
            </div>
            <div className={cn("flex flex-col gap-2", isDarkMode ? 'text-[#CAD0D7]' : 'text-[#838D9D]')}>
                <p className="text-sm font-bold text-center">Agent Card URL Example</p>
                <p className="text-sm font-medium text-center">https://your.agent.url/.well-known/agent.json</p>
            </div>
            <p className={cn("text-xs font-medium text-center", isDarkMode ? 'text-[#FFB020]' : 'text-[#B78213]')}>
                ⚠️Your agent must support <span className="text-[#7F4FE8] underline">A2A (Agent-to-Agent)</span>
            </p>
        </div>
    )
}
