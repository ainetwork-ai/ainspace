'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import Button from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { AgentProfile } from '../AgentProfile';
import { StoredAgent } from '@/lib/redis';

type TabType = 'default' | 'custom';
type SpriteType = 'sprite_default_male' | 'sprite_default_female' | 'sprite_cat';

interface UploadImageModalProps {
    onConfirm?: (agent: StoredAgent, spriteUrl: string) => void;
    agent: StoredAgent;
    children: React.ReactNode;
}

const DEFAULT_SPRITES: { id: SpriteType; url: string; name: string }[] = [
    { id: 'sprite_default_male', url: '/sprite/sprite_default_male.png', name: 'Male Character' },
    { id: 'sprite_default_female', url: '/sprite/sprite_default_female.png', name: 'Female Character' },
    { id: 'sprite_cat', url: '/sprite/sprite_cat.png', name: 'Cat' },
];

export default function UploadImageModal({ onConfirm, agent, children }: UploadImageModalProps) {
    const [activeTab, setActiveTab] = useState<TabType>('default');
    const [selectedSprite, setSelectedSprite] = useState<SpriteType>('sprite_default_male');
    const [isOpen, setIsOpen] = useState(false);

    const handleConfirm = () => {
        if (activeTab === 'default') {
            console.log('selectedSprite', selectedSprite);
            const selectedSpriteData = DEFAULT_SPRITES.find(s => s.id === selectedSprite);
            if (selectedSpriteData && onConfirm) {
                onConfirm(agent, selectedSpriteData.url);
            }
        }
        setIsOpen(false);
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent className="max-w-md p-0">
                <DialogHeader className="px-6 pt-6 pb-4">
                    <DialogTitle className="text-xl font-bold text-black text-center">
                        Set Agent Appearance
                    </DialogTitle>
                </DialogHeader>
                
                {/* Tabs */}
                <div className="flex flex-row gap-0 px-6 border-b border-[#EAEAEA]">
                    <button
                        onClick={() => setActiveTab('default')}
                        className={cn(
                            'flex-1 pb-3 font-semibold transition-colors',
                            activeTab === 'default'
                                ? 'text-black border-b-2 border-[#7F4FE8]'
                                : 'text-[#838D9D] border-b-2 border-transparent'
                        )}
                    >
                        Default
                    </button>
                    <button
                        onClick={() => setActiveTab('custom')}
                        className={cn(
                            'flex-1 pb-3 font-semibold transition-colors',
                            activeTab === 'custom'
                                ? 'text-black border-b-2 border-[#7F4FE8]'
                                : 'text-[#838D9D] border-b-2 border-transparent'
                        )}
                    >
                        Custom
                    </button>
                </div>

                {/* Content */}
                <div className="px-6 py-6">
                    {activeTab === 'default' ? (
                        <div className="grid grid-cols-3 gap-4">
                            {DEFAULT_SPRITES.map((sprite) => (
                                <button
                                    key={sprite.id}
                                    onClick={() => setSelectedSprite(sprite.id)}
                                    className={cn(
                                        'relative aspect-square rounded-lg overflow-hidden border-2 transition-all',
                                        selectedSprite === sprite.id
                                            ? 'border-[#7F4FE8]'
                                            : 'border-[#E6EAEF] hover:border-[#C0A9F1]'
                                    )}
                                >
                                    <AgentProfile
                                        width={88}
                                        height={88}
                                        imageUrl={sprite.url}
                                    />
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-8 text-center">
                            <p className="text-[#838D9D] text-sm font-medium">
                                Custom upload coming soon
                            </p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 pb-6">
                    <Button
                        onClick={handleConfirm}
                        type="large"
                        variant="primary"
                        className="w-full"
                    >
                        Confirm
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
