'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import Button from '@/components/ui/Button';
import { MOVEMENT_MODE } from '@/constants/game';

// NOTE: DB values differ from display labels
// stationary = Fixed Position
// spawn_centered = Nearby Activity
// village_wide = Free Activity

interface MovementOption {
    value: MOVEMENT_MODE;
    label: string;
    emoji: string;
    description: string;
}

const MOVEMENT_OPTIONS: MovementOption[] = [
    {
        value: MOVEMENT_MODE.VILLAGE_WIDE,
        label: 'Free Activity',
        emoji: '🥾',
        description: 'Suitable for agents designed to interact throughout the village.',
    },
    {
        value: MOVEMENT_MODE.SPAWN_CENTERED,
        label: 'Nearby Activity',
        emoji: '👥',
        description: 'Ideal for agents assigned to a specific area or exhibition.',
    },
    {
        value: MOVEMENT_MODE.STATIONARY,
        label: 'Fixed Position',
        emoji: '📍',
        description: 'Suitable for guide, docent, or standby agents.',
    },
];

interface MovementStyleModalProps {
    onConfirm: (style: MOVEMENT_MODE) => void;
    initialStyle?: MOVEMENT_MODE;
}

export default function MovementStyleModal({
    onConfirm,
    initialStyle = MOVEMENT_MODE.STATIONARY,
}: MovementStyleModalProps) {
    const [selectedStyle, setSelectedStyle] = useState<MOVEMENT_MODE>(initialStyle);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);

    const selectedOption = MOVEMENT_OPTIONS.find((opt) => opt.value === selectedStyle)!;

    const handleSelect = (value: MOVEMENT_MODE) => {
        setSelectedStyle(value);
        setIsDropdownOpen(false);
    };

    const handleConfirm = () => {
        onConfirm(selectedStyle);
    };

    return (
        <div className="relative flex flex-col items-center gap-4 max-w-[328px] bg-white p-6 shadow-lg w-full rounded-2xl ">
            <div className="flex flex-col items-center gap-1">
                <h2 className="text-xl font-bold text-black">Select Movement Style</h2>
                <p className="text-[#7F4FE8] font-semibold leading-[150%]">Choose how your agent behaves</p>
            </div>

            {/* Dropdown */}
            <div className="w-full relative">
                <button
                    type="button"
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    className={cn(
                        'w-full flex items-center justify-between px-4 py-3 rounded-lg border-2 transition-colors',
                        isDropdownOpen ? 'border-[#7F4FE8]' : 'border-gray-200 hover:border-gray-300'
                    )}
                >
                    <span className="flex items-center gap-2 text-lg font-medium text-gray-800">
                        <span>{selectedOption.emoji}</span>
                        <span>{selectedOption.label}</span>
                    </span>
                    <ChevronDown
                        className={cn(
                            'w-5 h-5 text-gray-500 transition-transform',
                            isDropdownOpen && 'rotate-180'
                        )}
                    />
                </button>

                {/* Dropdown Menu */}
                {isDropdownOpen && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 overflow-hidden">
                        {MOVEMENT_OPTIONS.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => handleSelect(option.value)}
                                className={cn(
                                    'w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-50 transition-colors',
                                    selectedStyle === option.value && 'bg-[#F9F7FF]'
                                )}
                            >
                                <span>{option.emoji}</span>
                                <span className="font-medium text-gray-800">{option.label}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Description */}
            <p className="text-gray-500 text-center text-sm">{selectedOption.description}</p>

            {/* Action Button */}
            <Button onClick={handleConfirm} type="large" variant="primary">
                Continue
            </Button>
        </div>
    );
}
