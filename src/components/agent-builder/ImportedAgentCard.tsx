'use client';

import { StoredAgent } from '@/lib/redis';
import { AgentProfile } from '@/components/AgentProfile';
import Button from '@/components/ui/Button';
import { MapPinIcon, MapPinOffIcon, Trash2Icon, CameraIcon } from 'lucide-react';
import UploadImageModal from './UploadImageModal';
import DeleteConfirmModal from './DeleteConfirmModal';

interface ImportedAgentCardProps {
    agent: StoredAgent;
    onPlaceAgent: (agent: StoredAgent) => void;
    onUnplaceAgent: (agent: StoredAgent) => void;
    onRemoveAgent: (url: string) => void;
    onUploadImage: (agent: StoredAgent, spriteUrl: string) => void;
}

export default function ImportedAgentCard({
    agent,
    onPlaceAgent,
    onUnplaceAgent,
    onUploadImage,
    onRemoveAgent,
}: ImportedAgentCardProps) {
    const { url, card, spriteUrl, isPlaced } = agent;

    return (
        <div className="flex flex-col gap-2 p-[14px] border border-[#E6EAEF] rounded-[8px]">
            <div className="flex flex-row justify-between">
                <AgentProfile width={40} height={40} imageUrl={spriteUrl} backgroundColor={"#F5F7FB"} />
                <div className="flex flex-row gap-1">
                    {
                      spriteUrl &&
                        <Button
                            onClick={isPlaced ? () => onUnplaceAgent(agent) : () => onPlaceAgent(agent)}
                            type="small"
                            variant={isPlaced ? 'secondary' : 'primary'}
                            className="h-fit p-[9px] flex flex-row gap-1 items-center justify-center"
                        >
                            {
                                isPlaced ?
                                    <MapPinOffIcon className="w-4 h-4" type="icon" strokeWidth={1.3} /> :
                                    <MapPinIcon className="w-4 h-4" type="icon" strokeWidth={1.3} />
                            }
                            <p className="text-sm font-medium leading-none">{isPlaced ? 'Unplace' : 'Place'}</p>
                        </Button>
                    }
                    <UploadImageModal onConfirm={onUploadImage} agent={agent}>
                        <Button
                            type="small"
                            variant={`${spriteUrl ? 'secondary' : 'primary'}`}
                            className="h-fit p-[9px] flex flex-row gap-1 items-center justify-center"
                        >
                            <CameraIcon className="w-4 h-4" type="icon" strokeWidth={1.3} />
                            <p className="text-sm font-medium leading-none">Edit</p>
                        </Button>
                    </UploadImageModal>
                    <DeleteConfirmModal onConfirm={() => onRemoveAgent(url)}>
                        <Button
                            type="small"
                            variant="ghost"
                            className="h-fit p-[9px]"
                        >
                            <Trash2Icon className="w-4 h-4 text-[#969EAA]" type="icon" strokeWidth={1.3} />
                        </Button>
                    </DeleteConfirmModal>
                </div>
            </div>
            <p className="text-black font-semibold text-sm">{card.name}</p>
            <p className="text-[#838D9D] font-medium text-sm line-clamp-4">{card.description}</p>
        </div>
    )
}