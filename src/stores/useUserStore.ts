import { create } from 'zustand';
import { UserPermissions } from '@/types/auth';

interface UserStore {
  address: string | null;
  permissions: UserPermissions | null;
  setAddress: (address: string | null) => void;
  setPermissions: (permissions: UserPermissions | null) => void;
  clearUser: () => void;
}

export const useUserStore = create<UserStore>((set) => ({
  address: null,
  permissions: null,
  setAddress: (address) => set({ address }),
  setPermissions: (permissions) => set({ permissions }),
  clearUser: () => set({ address: null, permissions: null }),
}));
