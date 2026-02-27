import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { UserPermissions } from '@/types/auth';

const SESSION_STORAGE_KEY = 'ainspace-session-id';
const MIGRATION_DONE_KEY = 'ainspace-migration-done';

interface UserStore {
  address: string | null;
  sessionId: string | null;
  permissions: UserPermissions | null;
  lastVerifiedAt: number | null;

  getUserId: () => string | null;
  isWalletConnected: () => boolean;
  getSessionId: () => string | null;
  hasMigratedThreads: (walletAddress: string) => boolean;
  setMigratedThreads: (walletAddress: string) => void;

  setAddress: (address: string | null) => void;
  setPermissions: (permissions: UserPermissions | null) => void;
  setLastVerifiedAt: (timestamp: number) => void;
  initSessionId: () => void;
  resetSessionId: () => void;
  clearUser: () => void;
  verifyPermissions: (address: string) => Promise<{ success: boolean; permissions?: UserPermissions }>;
  checkPermission: (permissionKey: keyof UserPermissions['permissions']) => boolean;
  isPermissionExpired: () => boolean;
}

const VERIFY_COOLDOWN = 1000; // 1 second - prevents rapid API calls
const PERMISSION_EXPIRY_TIME = 6 * 60 * 60 * 1000; // 6 hours - permission cache validity

export const useUserStore = create<UserStore>((set, get) => ({
  address: null,
  sessionId: null,
  permissions: null,
  lastVerifiedAt: null,

  getUserId: () => {
    const state = get();
    return state.address || state.sessionId;
  },

  isWalletConnected: () => !!get().address,

  getSessionId: () => get().sessionId,

  hasMigratedThreads: (walletAddress: string) => {
    if (typeof window === 'undefined') return true;
    const migratedWallets = localStorage.getItem(MIGRATION_DONE_KEY);
    if (!migratedWallets) return false;
    try {
      const wallets: string[] = JSON.parse(migratedWallets);
      return wallets.includes(walletAddress.toLowerCase());
    } catch {
      return false;
    }
  },

  setMigratedThreads: (walletAddress: string) => {
    if (typeof window === 'undefined') return;
    const migratedWallets = localStorage.getItem(MIGRATION_DONE_KEY);
    let wallets: string[] = [];
    if (migratedWallets) {
      try {
        wallets = JSON.parse(migratedWallets);
      } catch {
        wallets = [];
      }
    }
    const lowerAddress = walletAddress.toLowerCase();
    if (!wallets.includes(lowerAddress)) {
      wallets.push(lowerAddress);
      localStorage.setItem(MIGRATION_DONE_KEY, JSON.stringify(wallets));
    }
  },

  setAddress: (address) => set({ address }),
  setPermissions: (permissions) => set({ permissions }),
  setLastVerifiedAt: (timestamp) => set({ lastVerifiedAt: timestamp }),

  initSessionId: () => {
    if (typeof window === 'undefined') return;
    let sessionId = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!sessionId) {
      sessionId = uuidv4();
      localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    }
    set({ sessionId });
  },

  resetSessionId: () => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(SESSION_STORAGE_KEY);
    set({ sessionId: null });
    get().initSessionId();
  },

  clearUser: () => set({ address: null, permissions: null, lastVerifiedAt: null }),

  // Verify permissions with cooldown
  verifyPermissions: async (address: string) => {
    const state = get();
    const now = Date.now();

    // Check cooldown
    if (state.lastVerifiedAt && now - state.lastVerifiedAt < VERIFY_COOLDOWN) {
      console.log('Verify cooldown active, using cached permissions');
      return { success: true, permissions: state.permissions || undefined };
    }

    try {
      const response = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: address }),
      });

      if (!response.ok) {
        console.error('Failed to verify permissions:', response.statusText);
        return { success: false };
      }

      const data = await response.json();
      if (data.success && data.data?.permissions) {
        set({
          permissions: data.data.permissions,
          lastVerifiedAt: now,
        });
        return { success: true, permissions: data.data.permissions };
      }

      return { success: false };
    } catch (error) {
      console.error('Error verifying permissions:', error);
      return { success: false };
    }
  },

  // Check if user has a specific permission
  checkPermission: (permissionKey) => {
    const state = get();
    if (!state.permissions?.permissions) return false;

    const value = state.permissions.permissions[permissionKey];

    // Handle boolean permissions
    if (typeof value === 'boolean') return value;

    // Handle number permissions (quota)
    if (typeof value === 'number') return value > 0;

    // Handle array permissions
    if (Array.isArray(value)) return value.length > 0;

    return false;
  },

  // Check if permission cache has expired
  isPermissionExpired: () => {
    const state = get();
    if (!state.lastVerifiedAt) return true;
    const now = Date.now();
    return now - state.lastVerifiedAt > PERMISSION_EXPIRY_TIME;
  },
}));
