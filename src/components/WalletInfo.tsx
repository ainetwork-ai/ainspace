'use client';

import Image from 'next/image';
import { Check, Copy, LogOut } from 'lucide-react';
import { useAccount } from 'wagmi';
import { disconnect } from '@wagmi/core';
import { config } from '@/lib/wagmi-config';
import { shortAddress } from '@/lib/utils';
import { useCopyAddress } from '@/hooks/useCopyAddress';
import { useThreadStore, useUserStore } from '@/stores';
import { logoutBackendSession } from '@/lib/backend/auth';

export default function WalletInfo() {
    const { address } = useAccount();
    // EPIC18: a kiosk session has no wallet address — fall back to the backend
    // user's address so the kiosk shows as a normal logged-in user. Wallet path
    // is unchanged (address takes precedence). EPIC20: an email session may have
    // no ainAddress either, so fall back to the displayName as the label.
    const backendUser = useUserStore((s) => s.backendUser);
    const isBackendAuthed = useUserStore((s) => s.isBackendAuthed);
    const isKioskSession = useUserStore((s) => s.isKioskSession);
    const clearBackendAuth = useUserStore((s) => s.clearBackendAuth);
    const displayAddress = address ?? backendUser?.ainAddress ?? null;
    const label = displayAddress ? shortAddress(displayAddress) : (backendUser?.displayName || 'Account');
    const { isCopied, handleCopy } = useCopyAddress(displayAddress ?? undefined);
    const clearThreads = useThreadStore((s) => s.clearThreads);

    // Logged in via wallet, email, or kiosk.
    const isLoggedIn = !!address || isBackendAuthed;
    if (!isLoggedIn) return null;

    // Logout is available to wallet and email sessions; a kiosk is a shared
    // wallet-less exhibition account and intentionally has no logout.
    const canLogout = !!address || (isBackendAuthed && !isKioskSession);

    const handleDisconnect = () => {
        // EPIC26: revoke the backend session + clear rt/sid cookies (best-effort)
        // so the session can't be revived from the leftover httpOnly cookie.
        void logoutBackendSession();
        if (address) disconnect(config);
        // EPIC20: email sessions are wallet-less, so wagmi disconnect alone won't
        // log them out — clear the backend session in the store so isLoggedIn flips.
        clearBackendAuth();
        clearThreads();
    };

    return (
        <div className="inline-flex flex-row items-center gap-2 rounded-lg bg-white p-2">
            <Image src="/agent/defaultAvatar.svg" alt="agent" width={20} height={20} />
            <p className="text-sm font-bold text-black">{label}</p>
            {/* Copy only when we have an address to copy (email w/o ainAddress: none). */}
            {displayAddress && (
                <button
                    onClick={handleCopy}
                    className="group cursor-pointer rounded p-0.5"
                    aria-label="Copy address"
                >
                    {isCopied ? (
                        <Check size={14} className="text-green-500" />
                    ) : (
                        <Copy
                            size={14}
                            className="text-gray-400 transition-colors group-hover:text-[#7F4FE8]"
                        />
                    )}
                </button>
            )}
            {/* Logout for wallet + email sessions; kiosk (shared) has none. */}
            {canLogout && (
                <button
                    onClick={handleDisconnect}
                    className="group cursor-pointer rounded p-0.5"
                    aria-label="Disconnect wallet"
                >
                    <LogOut
                        size={14}
                        className="text-gray-400 transition-colors group-hover:text-[#FE7474]"
                    />
                </button>
            )}
        </div>
    );
}
