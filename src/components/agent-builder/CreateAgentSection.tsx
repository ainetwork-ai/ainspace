'use client';

import Button from '@/components/ui/Button';
import { A2A_BUILDER_URL } from '@/constants/agentContract';
import sdk from '@farcaster/miniapp-sdk';

export default function CreateAgentSection() {
    const handleCreateAgent = async () => {
        if (await sdk.isInMiniApp()) {
            sdk.actions.openUrl({ url: A2A_BUILDER_URL });
        } else {
          window.open(A2A_BUILDER_URL, '_blank');
        }
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