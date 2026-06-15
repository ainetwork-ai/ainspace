'use client';

import Image from 'next/image';
import { Check, Copy, LogOut } from 'lucide-react';
import { useAccount } from 'wagmi';
import { disconnect } from '@wagmi/core';
import { config } from '@/lib/wagmi-config';
import { shortAddress } from '@/lib/utils';
import { useCopyAddress } from '@/hooks/useCopyAddress';
import { useThreadStore, useUserStore } from '@/stores';

export default function WalletInfo() {
    const { address } = useAccount();
    // EPIC18: a kiosk session has no wallet address — fall back to the backend
    // user's address so the kiosk shows as a normal logged-in user. Wallet path
    // is unchanged (address takes precedence).
    const backendAddress = useUserStore((s) => s.backendUser?.ainAddress);
    const displayAddress = address ?? backendAddress;
    const { isCopied, handleCopy } = useCopyAddress(displayAddress);
    const clearThreads = useThreadStore((s) => s.clearThreads);

    if (!displayAddress) return null;

    const handleDisconnect = () => {
        disconnect(config);
        clearThreads();
    };

    return (
        <div className="inline-flex flex-row items-center gap-2 rounded-lg bg-white p-2">
            <Image src="/agent/defaultAvatar.svg" alt="agent" width={20} height={20} />
            <p className="text-sm font-bold text-black">{shortAddress(displayAddress)}</p>
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
            {/* Disconnect only applies to a real wallet connection (kiosk has none). */}
            {address && (
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
