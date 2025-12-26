'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import Button from '@/components/ui/Button';
import { MAP_NAMES } from '@/constants/game';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUserStore } from '@/stores';

interface MapSelectorModalProps {
    onConfirm?: (selectedMap: MAP_NAMES) => void;
    children: React.ReactNode;
    defaultMap?: MAP_NAMES;
}

// All available map options
// FIXME(yoojin): Get maps from DB
const ALL_MAP_OPTIONS: { value: MAP_NAMES; label: string; emoji: string }[] = [
    { value: MAP_NAMES.UNCOMMON_VILLAGE, label: 'Uncommon Village', emoji: '🎨' },
    { value: MAP_NAMES.UNBLOCK_VILLAGE, label: 'DAO Lab Village', emoji: '📄' },
    { value: MAP_NAMES.HAHOE_VILLAGE, label: 'Andong Hahoe Village', emoji: '🇰🇷' },
    { value: MAP_NAMES.HAPPY_VILLAGE, label: 'Happy Village', emoji: '😊' },
    { value: MAP_NAMES.HARRIS_VILLAGE, label: 'Harris Village', emoji: '🏠' },
];

export default function MapSelectorModal({ onConfirm, children, defaultMap }: MapSelectorModalProps) {
    const { permissions } = useUserStore();
    const [isOpen, setIsOpen] = useState(false);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Filter map options based on user permissions
    const MAP_OPTIONS = useMemo(() => {
        if (!permissions?.permissions?.placeAllowedMaps) {
            return [];
        }

        const allowedMaps = permissions.permissions.placeAllowedMaps;

        // If '*' is in allowed maps, return all options
        if (allowedMaps.includes('*')) {
            return ALL_MAP_OPTIONS;
        }

        // Filter options based on allowed maps
        return ALL_MAP_OPTIONS.filter(option =>
            allowedMaps.includes(option.value)
        );
    }, [permissions]);

    const [selectedMap, setSelectedMap] = useState<MAP_NAMES>(
        defaultMap || MAP_OPTIONS[0]?.value
    );

    // Update selected map when options change
    useEffect(() => {
        if (MAP_OPTIONS.length > 0 && !MAP_OPTIONS.find(opt => opt.value === selectedMap)) {
            setSelectedMap(MAP_OPTIONS[0].value);
        }
    }, [MAP_OPTIONS, selectedMap]);

    const selectedOption = MAP_OPTIONS.find(option => option.value === selectedMap) || MAP_OPTIONS[0];

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsDropdownOpen(false);
            }
        };

        if (isDropdownOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isDropdownOpen]);

    const handleConfirm = () => {
        if (onConfirm) {
            onConfirm(selectedMap);
        }
        setIsOpen(false);
        setIsDropdownOpen(false);
    };

    const handleOpenChange = (open: boolean) => {
        setIsOpen(open);
        if (!open) {
            setIsDropdownOpen(false);
        }
    };

    const handleSelectMap = (map: MAP_NAMES) => {
        console.log('map', map);
        setSelectedMap(map);
        setIsDropdownOpen(false);
    };

    const hasPermissions = MAP_OPTIONS.length > 0;

    return (
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent className="max-w-xs px-4 py-6 gap-4 bg-white rounded-2xl" showCloseButton={false}>
                <DialogHeader>
                    <DialogTitle className="text-xl font-bold text-black text-center">
                        Pick a home for your agent
                    </DialogTitle>
                </DialogHeader>

                {!hasPermissions ? (
                    <div className="py-6 text-center text-gray-500">
                        You don&apos;t have permission to place agents on any map.
                    </div>
                ) : (
                    <>
                        {/* Dropdown Selector */}
                        <div className="relative">
                            <div className="relative" ref={dropdownRef}>
                                <button
                                    type="button"
                                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                                    className={cn(
                                        "w-full flex items-center justify-between p-4",
                                        "rounded-lg border border-gray-300 bg-white",
                                        "text-black text-base font-semibold",
                                        "hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-[#7F4FE8] focus:border-transparent",
                                        "transition-colors"
                                    )}
                                >
                                    <span className="flex items-center gap-2">
                                        <span>{selectedOption?.emoji}</span>
                                        <span>{selectedOption?.label}</span>
                                    </span>
                                    <ChevronDown
                                        className={cn(
                                            "w-5 h-5 text-gray-500 transition-transform",
                                            isDropdownOpen && "transform rotate-180"
                                        )}
                                    />
                                </button>

                                {/* Dropdown Options */}
                                {isDropdownOpen && (
                                    <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg overflow-hidden">
                                        {MAP_OPTIONS.map((option) => (
                                            <button
                                                key={option.value}
                                                type="button"
                                                onClick={() => handleSelectMap(option.value)}
                                                className={cn(
                                                    "w-full flex items-center justify-between px-4 py-3",
                                                    "text-left text-black text-base font-normal",
                                                    "hover:bg-gray-50 transition-colors",
                                                    selectedMap === option.value && "bg-[#F9F7FF]"
                                                )}
                                            >
                                                <span className="flex items-center gap-2">
                                                    <span>{option.emoji}</span>
                                                    <span>{option.label}</span>
                                                </span>
                                                {selectedMap === option.value && (
                                                    <Check className="w-5 h-5 text-[#7F4FE8]" />
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        <Button
                            onClick={handleConfirm}
                            type="large"
                            variant="primary"
                            className="w-fit p-4"
                        >
                            Confirm
                        </Button>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
