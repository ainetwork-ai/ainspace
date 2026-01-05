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

export default function ConnectWalletModal({
    open,
    onOpenChange,
}: ConnectWalletModalProps) {
    const { connect, connectors } = useConnect();

    const handleConnect = () => {
        onOpenChange(false);
        connect({ connector: connectors[0] });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[300px] bg-white rounded-2xl py-6 px-4 shadow-lg flex flex-col gap-4">
                <DialogHeader className="flex flex-col items-center gap-1 pt-2">
                    <div className="w-16 h-16 bg-[#f7f0ff] rounded-full flex items-center justify-center mb-2">
                        <Wallet className="w-8 h-8 text-[#7C3AED]" />
                    </div>
                    <DialogTitle className="text-xl font-bold text-black text-center">
                        Wallet Required
                    </DialogTitle>
                    <DialogDescription className="text-base text-[#2F333B] text-center">
                        This feature requires a wallet connection.
                    </DialogDescription>
                </DialogHeader>

                <button
                    onClick={handleConnect}
                    className="w-full py-3 px-4 bg-[#7C3AED] text-white font-bold rounded-lg hover:bg-[#6D28D9] transition-colors"
                >
                    Connect Wallet
                </button>

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
