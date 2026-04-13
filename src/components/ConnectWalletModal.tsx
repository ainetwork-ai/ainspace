'use client';

import React, { useEffect } from 'react';
import { useConnect } from 'wagmi';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { Wallet } from 'lucide-react';

interface ConnectWalletModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    isDarkMode?: boolean;
}

const CONNECTOR_LABELS: Record<string, string> = {
    baseAccount: 'Base Account',
    injected: 'Browser Wallet',
};

// Connectors we configured — auto-detected ones (like "Base" from Base App) are not in this set
const CONFIGURED_CONNECTOR_IDS = new Set(['baseAccount', 'injected']);

export default function ConnectWalletModal({
    open,
    onOpenChange,
    isDarkMode = false,
}: ConnectWalletModalProps) {
    const { connect, connectors } = useConnect();

    // Base App injects its own connector (name: "Base") — auto-connect when detected
    const baseAppConnector = connectors.find(
        (c) => c.name === 'Base' && c.type === 'injected'
    );

    useEffect(() => {
        if (open && baseAppConnector) {
            onOpenChange(false);
            connect({ connector: baseAppConnector });
        }
    }, [open, baseAppConnector, connect, onOpenChange]);

    // If Base App connector exists, modal won't show (auto-connect above)
    // Otherwise show configured connectors for user to pick
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className={`w-[300px] rounded-2xl py-6 px-4 shadow-lg flex flex-col gap-4 border-none ${isDarkMode ? 'bg-[#2F333B] [&_[data-slot=dialog-close]]:text-white' : 'bg-white'}`}>
                <DialogHeader className="flex flex-col items-center gap-1 pt-2">
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-2 ${isDarkMode ? 'bg-[#3A3050]' : 'bg-[#f7f0ff]'}`}>
                        <Wallet className={`w-8 h-8 ${isDarkMode ? 'text-[#C0A9F1]' : 'text-[#7C3AED]'}`} />
                    </div>
                    <DialogTitle className={`text-xl font-bold text-center ${isDarkMode ? 'text-white' : 'text-black'}`}>
                        Connect Wallet
                    </DialogTitle>
                    <DialogDescription className={`text-base text-center ${isDarkMode ? 'text-[#CAD0D7]' : 'text-[#2F333B]'}`}>
                        Choose a wallet to connect.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-2">
                    {connectors
                        .filter((c) => CONFIGURED_CONNECTOR_IDS.has(c.id))
                        .map((connector) => (
                            <button
                                key={connector.id}
                                onClick={() => {
                                    onOpenChange(false);
                                    connect({ connector });
                                }}
                                className={`w-full py-3 px-4 font-bold rounded-lg transition-colors text-left ${isDarkMode ? 'bg-[#3A3050] text-[#C0A9F1] hover:bg-[#4A3E60]' : 'bg-[#F3F0FF] text-[#7C3AED] hover:bg-[#E8E0FF]'}`}
                            >
                                {CONNECTOR_LABELS[connector.id] ?? connector.name}
                            </button>
                        ))}
                </div>

                <button
                    onClick={() => onOpenChange(false)}
                    className={`w-full py-2 px-4 font-medium transition-colors ${isDarkMode ? 'text-[#838D9D] hover:text-[#CAD0D7]' : 'text-[#969EAA] hover:text-[#2F333B]'}`}
                >
                    Maybe Later
                </button>
            </DialogContent>
        </Dialog>
    );
}
