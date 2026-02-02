'use client';

import React from 'react';
import { X } from 'lucide-react';

interface PlaceAgentModalProps {
    allowedMaps: string[];
    errorMessage?: string | null;
    onCancel: () => void;
}

export default function PlaceAgentModal({
    allowedMaps,
    errorMessage,
    onCancel,
}: PlaceAgentModalProps) {
    const isAllMaps = allowedMaps.includes('*');

    return (
        <div className="relative flex flex-col items-center gap-4 bg-white px-10 py-6 shadow-lg w-full rounded-t-2xl md:w-auto md:rounded-2xl">
            <button
                onClick={onCancel}
                className="absolute right-4 top-4 text-gray-400 hover:text-gray-600 transition-colors"
            >
                <X size={24} />
            </button>

            <p className="text-center text-xl font-bold text-gray-800">
                Tap the map to place your agent
            </p>

            <div className="flex flex-col items-center gap-1">
                <p className="text-sm text-gray-400">
                    Allowed area:
                </p>

                <div className="flex flex-wrap justify-center gap-2">
                    {isAllMaps ? (
                        <span className="rounded-md bg-[#D7FFBD] px-3 py-1 text-sm font-medium text-[#189D35]">
                            All maps
                        </span>
                    ) : (
                        allowedMaps.map((mapName) => (
                            <span
                                key={mapName}
                                className="rounded-md bg-[#D7FFBD] px-3 py-1 text-sm font-medium text-[#189D35]"
                            >
                                {mapName}
                            </span>
                        ))
                    )}
                </div>

                {errorMessage ? (
                    <p className="text-sm text-red-500 text-center mt-1">
                        {errorMessage}
                    </p>
                ) : (
                    <p className="text-sm text-[#4595FF] text-center mt-1">
                        Tap once to preview. Tap again to place.
                    </p>
                )}
            </div>
        </div>
    );
}
