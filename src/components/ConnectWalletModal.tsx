'use client';

import React from 'react';
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
}

const CONNECTOR_LABELS: Record<string, string> = {
    baseAccount: 'Base Account',
    injected: 'Browser Wallet',
};

export default function ConnectWalletModal({
    open,
    onOpenChange,
}: ConnectWalletModalProps) {
    const { connect, connectors } = useConnect();

    const handleConnect = (connectorId: string) => {
        const connector = connectors.find(c => c.id === connectorId);
        if (!connector) return;
        onOpenChange(false);
        connect({ connector });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[300px] bg-white rounded-2xl py-6 px-4 shadow-lg flex flex-col gap-4">
                <DialogHeader className="flex flex-col items-center gap-1 pt-2">
                    <div className="w-16 h-16 bg-[#f7f0ff] rounded-full flex items-center justify-center mb-2">
                        <Wallet className="w-8 h-8 text-[#7C3AED]" />
                    </div>
                    <DialogTitle className="text-xl font-bold text-black text-center">
                        Connect Wallet
                    </DialogTitle>
                    <DialogDescription className="text-base text-[#2F333B] text-center">
                        Choose a wallet to connect.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-2">
                    {connectors.map((connector) => (
                        <button
                            key={connector.id}
                            onClick={() => handleConnect(connector.id)}
                            className="w-full py-3 px-4 bg-[#F3F0FF] text-[#7C3AED] font-bold rounded-lg hover:bg-[#E8E0FF] transition-colors text-left"
                        >
                            {CONNECTOR_LABELS[connector.id] ?? connector.name}
                        </button>
                    ))}
                </div>

                <button
                    onClick={() => onOpenChange(false)}
                    className="w-full py-2 px-4 text-[#969EAA] font-medium hover:text-[#2F333B] transition-colors"
                >
                    Maybe Later
                </button>
            </DialogContent>
        </Dialog>
    );
}
