'use client';

import Image from 'next/image';
import { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import Button from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { AgentProfile } from '../AgentProfile';
import { StoredAgent } from '@/lib/redis';

type TabType = 'default' | 'custom';
type SpriteType = 'sprite_default_male' | 'sprite_default_female' | 'sprite_cat';
const SPRITE_HEIGHTS: { [key in SpriteType]: number } = {
    'sprite_default_male': 50,
    'sprite_default_female': 50,
    'sprite_cat': 40,
};

interface UploadImageModalProps {
    onConfirm?: (agent: StoredAgent, sprite: {url:string, height:number} | File) => void;
    agent: StoredAgent;
    children: React.ReactNode;
    isDarkMode?: boolean;
}

const DEFAULT_SPRITES: { id: SpriteType; url: string; name: string }[] = [
    { id: 'sprite_default_male', url: '/sprite/sprite_default_male.png', name: 'Male Character' },
    { id: 'sprite_default_female', url: '/sprite/sprite_default_female.png', name: 'Female Character' },
    { id: 'sprite_cat', url: '/sprite/sprite_cat.png', name: 'Cat' },
];

export default function UploadImageModal({ onConfirm, agent, children, isDarkMode = false }: UploadImageModalProps) {
    const [activeTab, setActiveTab] = useState<TabType>('default');
    const [selectedSprite, setSelectedSprite] = useState<SpriteType>('sprite_default_male');
    const [isOpen, setIsOpen] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Create preview URL when file is selected
    useEffect(() => {
        if (selectedFile) {
            const url = URL.createObjectURL(selectedFile);
            setPreviewUrl(url);
            return () => {
                URL.revokeObjectURL(url);
            };
        } else {
            setPreviewUrl(null);
        }
    }, [selectedFile]);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setSelectedFile(file);
        }
    };

    const handleUploadClick = () => {
        fileInputRef.current?.click();
    };

    const handleConfirm = () => {
        if (activeTab === 'default') {
            const selectedSpriteData = DEFAULT_SPRITES.find(s => s.id === selectedSprite);
            if (selectedSpriteData && onConfirm) {
                onConfirm(agent, {url: selectedSpriteData.url, height: SPRITE_HEIGHTS[selectedSprite]});
            }
        } else if (activeTab === 'custom' && selectedFile && onConfirm) {
            onConfirm(agent, selectedFile);
        }
        setIsOpen(false);
    };

    const renderActiveTabContent = () => {
        if (activeTab === 'default') {
            return (
              <div className="flex flex-col gap-6">
                <div className="flex flex-row justify-center gap-2">
                  {DEFAULT_SPRITES.map((sprite) => (
                    <button key={sprite.id} onClick={() => setSelectedSprite(sprite.id)} className={cn(
                      'relative w-22 h-22 rounded-lg overflow-hidden border-2 transition-all',
                      selectedSprite === sprite.id
                        ? 'border-[#7F4FE8]'
                        : isDarkMode ? 'border-[#4A4E56] hover:border-[#C0A9F1]' : 'border-[#E6EAEF] hover:border-[#C0A9F1]'
                    )}>
                        <AgentProfile
                          width={88}
                          height={88}
                          imageUrl={sprite.url}
                          backgroundColor={'#EDEFF2'}
                        />
                    </button>
                  ))}
                </div>
                <Button
                    onClick={handleConfirm}
                    type="large"
                    variant="primary"
                    isDarkMode={isDarkMode}
                    className="px-4 py-[18px]"
                >
                    Confirm
                </Button>
              </div>
            )
        } else {
            return (
                <div className="flex flex-col gap-6">
                    <div className="flex flex-col gap-2">
                        {/* Uploaded image preview */}
                        {previewUrl && (
                            <div className="flex flex-col items-center gap-2">
                                <div className="relative w-full h-full min-h-[22px]">
                                    <Image
                                        src={previewUrl}
                                        alt="Preview"
                                        fill
                                        className="object-contain"
                                        unoptimized
                                    />
                                </div>
                            </div>
                        )}
                        {/* File Input and Upload Button */}
                        <div className="flex gap-3">
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/png"
                                onChange={handleFileSelect}
                                className="hidden"
                            />
                            <input
                                type="text"
                                readOnly
                                value={selectedFile?.name || ''}
                                onClick={handleUploadClick}
                                placeholder="PNG image"
                                className={cn(
                                    "flex-1 px-4 py-2.5 border rounded-[4px] text-sm hover:cursor-pointer",
                                    isDarkMode
                                        ? 'bg-[#1A1D22] border-[#4A4E56] text-white placeholder:text-[#838D9D]'
                                        : 'bg-[#F3F4F5] border-[#CDD4DE] text-black placeholder:text-[#C6CDD5]'
                                )}
                            />
                            <Button
                                onClick={handleConfirm}
                                type="small"
                                variant="primary"
                                isDarkMode={isDarkMode}
                                className="px-6 py-2"
                                disabled={!selectedFile}
                            >
                                Upload
                            </Button>
                        </div>
                    </div>

                    {/* Info Box */}
                    <div className={cn(
                        "border-2 border-dashed rounded-lg p-4",
                        isDarkMode
                            ? 'bg-[#2A2518] border-[#4A4030]'
                            : 'bg-[#FFF9E6] border-[#E6D5A3]'
                    )}>
                        <div className="flex flex-col items-center gap-2">
                            {/* Sprite Preview Area - 레이아웃만 */}
                            <div className="flex flex-wrap gap-1 justify-center w-full min-h-[22px]">
                                <Image
                                    src={'/sprite/sprite_cat.png'}
                                    height={22}
                                    width={22/40*480} // 480 is the width of the sprite_cat.png
                                    alt="Sprite Preview"
                                />
                            </div>
                            <p className={cn("text-sm text-center", isDarkMode ? 'text-[#FFB020]' : 'text-[#B8860B]')}>
                                Upload a 40×40 transparent PNG sprite. (front-left-back-right)
                            </p>
                        </div>
                    </div>
                </div>
            )
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent className={cn("max-w-md px-4 py-6", isDarkMode && 'bg-[#2F333B]')}>
                <DialogHeader className="flex flex-col gap-3">
                    <DialogTitle className={cn("text-xl font-bold text-center", isDarkMode ? 'text-white' : 'text-black')}>
                        Set Agent Appearance
                    </DialogTitle>
                    {/* Tabs */}
                    <div className={cn("flex flex-row gap-0 px-6 border-b", isDarkMode ? 'border-[#4A4E56]' : 'border-[#EAEAEA]')}>
                        <button
                            onClick={() => setActiveTab('default')}
                            className={cn(
                                'flex-1 pb-3 font-semibold transition-colors',
                                activeTab === 'default'
                                    ? `border-b-2 border-[#7F4FE8] ${isDarkMode ? 'text-white' : 'text-black'}`
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
                                    ? `border-b-2 border-[#7F4FE8] ${isDarkMode ? 'text-white' : 'text-black'}`
                                    : 'text-[#838D9D] border-b-2 border-transparent'
                            )}
                        >
                            Custom
                        </button>
                    </div>
                </DialogHeader>
                {/* Content */}
                {renderActiveTabContent()}
            </DialogContent>
        </Dialog>
    );
}
