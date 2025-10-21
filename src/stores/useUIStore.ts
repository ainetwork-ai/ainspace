import { create } from 'zustand';

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
