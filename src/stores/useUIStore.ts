import { create } from 'zustand';

export const FOOTER_HEIGHT = 73; // 72px + 1px border

interface UIState {
    activeTab: 'map' | 'thread' | 'build' | 'agent';
    setActiveTab: (tab: 'map' | 'thread' | 'build' | 'agent') => void;
}

export const useUIStore = create<UIState>((set) => ({
    activeTab: 'map',
    setActiveTab: (tab) => set({ activeTab: tab }),
}));
