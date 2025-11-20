import { create } from 'zustand';

export const FOOTER_HEIGHT = 73; // 72px + 1px border

interface UIState {
    activeTab: 'map' | 'thread' | 'build' | 'agent';
    isBottomSheetOpen: boolean;
    setActiveTab: (tab: 'map' | 'thread' | 'build' | 'agent') => void;
    setIsBottomSheetOpen: (isOpen: boolean) => void;
    openBottomSheet: () => void;
    closeBottomSheet: () => void;
}

export const useUIStore = create<UIState>((set) => ({
    activeTab: 'map',
    isBottomSheetOpen: false,
    setActiveTab: (tab) => set({ activeTab: tab }),
    setIsBottomSheetOpen: (isOpen) => set({ isBottomSheetOpen: isOpen }),
    openBottomSheet: () => set({ isBottomSheetOpen: true }),
    closeBottomSheet: () => set({ isBottomSheetOpen: false })
}));
