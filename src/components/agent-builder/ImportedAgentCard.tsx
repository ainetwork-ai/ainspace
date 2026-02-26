'use client';

import { StoredAgent } from '@/lib/redis';
import { AgentProfile } from '@/components/AgentProfile';
import Button from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { MapPinIcon, MapPinOffIcon, Trash2Icon, CameraIcon } from 'lucide-react';
import UploadImageModal from './UploadImageModal';
import DeleteConfirmModal from './DeleteConfirmModal';

interface ImportedAgentCardProps {
    agent: StoredAgent;
    onPlaceAgent: (agent: StoredAgent) => void;
    onUnplaceAgent: (agent: StoredAgent) => void;
    onRemoveAgent: (url: string) => void;
    onUploadImage: (agent: StoredAgent, sprite: {url:string, height:number} | File) => void;
    isDarkMode?: boolean;
}

export default function ImportedAgentCard({
    agent,
    onPlaceAgent,
    onUnplaceAgent,
    onUploadImage,
    onRemoveAgent,
    isDarkMode = false,
}: ImportedAgentCardProps) {
    const { url, card, spriteUrl, isPlaced } = agent;

    return (
        <div className={cn(
            "flex flex-col gap-2 p-[14px] border rounded-[8px]",
            isDarkMode ? 'border-[#4A4E56]' : 'border-[#E6EAEF]'
        )}>
            <div className="flex flex-row justify-between">
                <AgentProfile width={40} height={40} imageUrl={spriteUrl} backgroundColor={isDarkMode ? "#3A3E46" : "#F5F7FB"} />
                <div className="flex flex-row gap-1">
                    {
                      spriteUrl && (
                        isPlaced ? (
                            <Button
                                onClick={() => onUnplaceAgent(agent)}
                                type="small"
                                variant="secondary"
                                isDarkMode={isDarkMode}
                                className="h-fit p-[9px] flex flex-row gap-1 items-center justify-center"
                            >
                                <MapPinOffIcon className="w-4 h-4" type="icon" strokeWidth={1.3} />
                                <p className="text-sm font-medium leading-none">Unplace</p>
                            </Button>
                        ) : (
                            <Button
                                onClick={() => onPlaceAgent(agent)}
                                type="small"
                                variant="primary"
                                isDarkMode={isDarkMode}
                                className="h-fit p-[9px] flex flex-row gap-1 items-center justify-center"
                            >
                                <MapPinIcon className="w-4 h-4" type="icon" strokeWidth={1.3} />
                                <p className="text-sm font-medium leading-none">Place</p>
                            </Button>
                        )
                      )
                    }
                    <UploadImageModal onConfirm={onUploadImage} agent={agent} isDarkMode={isDarkMode}>
                        <Button
                            type="small"
                            variant={`${spriteUrl ? 'secondary' : 'primary'}`}
                            isDarkMode={isDarkMode}
                            className="h-fit p-[9px] flex flex-row gap-1 items-center justify-center"
                        >
                            <CameraIcon className="w-4 h-4" type="icon" strokeWidth={1.3} />
                            <p className="text-sm font-medium leading-none">Edit</p>
                        </Button>
                    </UploadImageModal>
                    <DeleteConfirmModal onConfirm={() => onRemoveAgent(url)} isDarkMode={isDarkMode}>
                        <Button
                            type="small"
                            variant="ghost"
                            isDarkMode={isDarkMode}
                            className="h-fit p-[9px]"
                        >
                            <Trash2Icon className={cn("w-4 h-4", isDarkMode ? 'text-[#838D9D]' : 'text-[#969EAA]')} type="icon" strokeWidth={1.3} />
                        </Button>
                    </DeleteConfirmModal>
                </div>
            </div>
            <p className={cn("font-semibold text-sm", isDarkMode ? 'text-white' : 'text-black')}>{card.name}</p>
            <p className={cn("font-medium text-sm line-clamp-4", isDarkMode ? 'text-[#CAD0D7]' : 'text-[#838D9D]')}>{card.description}</p>
        </div>
    )
}