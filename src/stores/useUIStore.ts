import { create } from 'zustand';
import { StoredAgent } from '@/lib/redis';
import { MOVEMENT_MODE } from '@/constants/game';

export const FOOTER_HEIGHT = 73; // 72px + 1px border

export type TabType = 'map' | 'chat' | 'thread' | 'build' | 'agent';

interface UIState {
    activeTab: TabType;
    setActiveTab: (tab: TabType) => void;
    selectedAgentForPlacement: {
        agent: StoredAgent;
        allowedMaps: string[];
        movementMode: MOVEMENT_MODE;
    } | null;
    setSelectedAgentForPlacement: (data: UIState['selectedAgentForPlacement']) => void;
    // Global "connect wallet" modal — lets any component (e.g. the chat send
    // button) prompt login without threading modal state through every parent.
    isWalletModalOpen: boolean;
    setWalletModalOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
    activeTab: 'map',
    setActiveTab: (tab) => set({ activeTab: tab }),
    selectedAgentForPlacement: null,
    setSelectedAgentForPlacement: (data) => set({ selectedAgentForPlacement: data }),
    isWalletModalOpen: false,
    setWalletModalOpen: (open) => set({ isWalletModalOpen: open }),
}));
