'use client';

import React from 'react';
import Button from './ui/Button';
import { cn } from '@/lib/utils';

interface PlaceAgentModalProps {
    agentName: string;
    allowedMaps: string[];
    errorMessage?: string | null;
    onCancel: () => void;
}

export default function PlaceAgentModal({
    agentName,
    allowedMaps,
    errorMessage,
    onCancel,
}: PlaceAgentModalProps) {
    const isAllMaps = allowedMaps.includes('*');

    return (
        <div className="flex flex-col items-center gap-4 rounded-2xl bg-white px-[50px] py-6 shadow-lg overflow-hidden">
            <p className="text-center text-xl font-bold text-gray-800">
                Tap on the map to place<br />
                &apos;{agentName}&apos;
            </p>

            <div className="flex flex-col items-center gap-2">
                <p className="text-sm text-gray-400">
                    Allowed area:
                </p>

                {isAllMaps ? (
                    <span className="rounded-sm bg-[#D7FFBD] px-2 py-1 text-sm font-medium text-[#189D35]">
                        All maps
                    </span>
                ) : (
                    allowedMaps.map((mapName) => (
                        <span
                            key={mapName}
                            className="rounded-sm bg-[#D7FFBD] px-2 py-1 text-sm font-medium text-[#189D35]"
                        >
                            {mapName}
                        </span>
                    ))
                )}
                {errorMessage && (
                    <p className="text-sm text-red-500 text-center break-words max-w-[180px]">
                        {errorMessage}
                    </p>
                )}
            </div>

            <Button
                onClick={onCancel}
                type="large"
                variant="secondary"
                className={cn(
                    "flex-1 mt-2 bg-white border border-[#7F4FE8] text-[#7F4FE8] hover:bg-[#F9F7FF]",
                    "hover:border-[#7F4FE8]"
                )}
            >
                Cancel
            </Button>
        </div>
    );
}
