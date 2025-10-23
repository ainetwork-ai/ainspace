import { DIRECTION, INITIAL_PLAYER_POSITION } from '@/constants/game';
import { create } from 'zustand';

interface Position {
    x: number;
    y: number;
}

interface GameState {
    worldPosition: Position;
    playerDirection: DIRECTION;
    isLoading: boolean;
    isAutonomous: boolean;
    recentMovements: string[];
    lastCommentary: string;
    lastMoveTime: number;
    isPlayerMoving: boolean;

    setWorldPosition: (position: Position) => void;
    setPlayerDirection: (direction: DIRECTION) => void;
    setIsLoading: (isLoading: boolean) => void;
    setIsAutonomous: (isAutonomous: boolean) => void;
    setRecentMovements: (movements: string[]) => void;
    setLastCommentary: (commentary: string) => void;
    setLastMoveTime: (time: number) => void;
    setIsPlayerMoving: (isPlayerMoving: boolean) => void;
}

export const useGameStateStore = create<GameState>((set, get) => ({
    worldPosition: INITIAL_PLAYER_POSITION,
    isLoading: true,
    isAutonomous: false,
    playerDirection: DIRECTION.RIGHT,
    recentMovements: [],
    lastCommentary: '',
    lastMoveTime: 0,
    isPlayerMoving: false,

    setWorldPosition: (position: Position) => {
        set({ worldPosition: position });
    },

    setIsLoading: (isLoading: boolean) => {
        set({ isLoading });
    },

    setIsAutonomous: (isAutonomous: boolean) => {
        set({ isAutonomous });
    },

    setPlayerDirection: (direction: DIRECTION) => {
        set({ playerDirection: direction });
    },

    setRecentMovements: (movements: string[]) => {
        set({ recentMovements: movements });
    },
    
    setLastCommentary: (commentary: string) => {
        set({ lastCommentary: commentary });
    },

    setLastMoveTime: (time: number) => {
        set({ lastMoveTime: time });
    },

    setIsPlayerMoving: (isPlayerMoving: boolean) => {
        set({ isPlayerMoving });
    },
}));