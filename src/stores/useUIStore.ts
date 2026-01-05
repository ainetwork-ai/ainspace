import { create } from 'zustand';
import { StoredAgent } from '@/lib/redis';

export const FOOTER_HEIGHT = 73; // 72px + 1px border

interface UIState {
    activeTab: 'map' | 'thread' | 'build' | 'agent';
    setActiveTab: (tab: 'map' | 'thread' | 'build' | 'agent') => void;
    selectedAgentForPlacement: {
        agent: StoredAgent;
        allowedMaps: string[];
    } | null;
    setSelectedAgentForPlacement: (data: UIState['selectedAgentForPlacement']) => void;
}

export const useUIStore = create<UIState>((set) => ({
    activeTab: 'map',
    setActiveTab: (tab) => set({ activeTab: tab }),
    selectedAgentForPlacement: null,
    setSelectedAgentForPlacement: (data) => set({ selectedAgentForPlacement: data }),
}));
