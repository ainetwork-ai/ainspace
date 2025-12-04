'use client';

import Button from '@/components/ui/Button';
import { useState } from "react";

interface ImportAgentSectionProps {
    handleImportAgent: (agentUrl: string) => void;
    isLoading: boolean;
}

export default function ImportAgentSection({
    handleImportAgent,
    isLoading
}: ImportAgentSectionProps) {
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
