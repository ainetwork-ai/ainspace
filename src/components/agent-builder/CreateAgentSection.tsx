'use client';

import Button from '@/components/ui/Button';
import { A2A_BUILDER_URL } from '@/constants/agentContract';
import { cn } from '@/lib/utils';
import sdk from '@farcaster/miniapp-sdk';

interface CreateAgentSectionProps {
    isDarkMode?: boolean;
}

export default function CreateAgentSection({ isDarkMode = false }: CreateAgentSectionProps) {
    const handleCreateAgent = async () => {
        if (await sdk.isInMiniApp()) {
            sdk.actions.openUrl({ url: A2A_BUILDER_URL });
        } else {
          window.open(A2A_BUILDER_URL, '_blank');
        }
    }

    return (
        <div className={cn(
            'flex flex-col gap-4 p-6 border rounded-[8px]',
            isDarkMode
                ? 'bg-[#222529] border-[#4A4E56]'
                : 'bg-white border-[#E6EAEF]'
        )}>
            <div className="flex flex-col gap-2">
                <p className={cn("text-xl font-semibold text-center", isDarkMode ? 'text-white' : 'text-black')}>Create New Agent 🔮</p>
                <p className={cn("text-sm font-medium text-center", isDarkMode ? 'text-[#CAD0D7]' : 'text-[#838D9D]')}>Generate AI Agent with A2A Builder</p>
            </div>
            <Button
                onClick={handleCreateAgent}
                className="w-full"
                type="large"
                isDarkMode={isDarkMode}
            >
                A2A Builder
            </Button>
        </div>
    )
}