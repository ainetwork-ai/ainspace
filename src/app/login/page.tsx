'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import ConnectWalletModal from '@/components/ConnectWalletModal';

export default function LoginPage() {
    const { isConnected, isConnecting } = useAccount();
    const router = useRouter();
    const [showButton, setShowButton] = useState(false);
    const [showWalletModal, setShowWalletModal] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => {
            setShowButton(true);
        }, 100);

        return () => clearTimeout(timer);
    }, []);

    // Redirect to home page if wallet is already connected
    useEffect(() => {
        if (isConnecting) return;
        if (isConnected) {
            router.push('/');
        }
    }, [isConnected, isConnecting, router]);

    return (
        <div className="flex h-screen w-full max-w-800 flex-col items-center justify-center gap-6 bg-[#B1E1FF]">
            <Image src="/login/logo.svg" alt="Login Background" className="z-10" width={190} height={108} />
            <div
                className={cn(
                    'z-10 h-14 transition-all duration-700 ease-out',
                    showButton ? 'opacity-100' : 'opacity-0'
                )}
            >
                <button
                    onClick={() => setShowWalletModal(true)}
                    className="z-10 inline-flex h-14 w-[180px] cursor-pointer items-center justify-center self-center rounded bg-[#7f4fe8] text-white font-medium"
                >
                    Connect Wallet
                </button>
            </div>
            <Image src="/login/ainetwork.svg" alt="ainetwork" className="z-10" width={133} height={22} />
            <div className="h-10" />
            <div className="fixed bottom-0 flex w-full justify-center">
                <Image src="/login/login_background.png" alt="Login Background" width={600} height={1000} />
            </div>
            <ConnectWalletModal open={showWalletModal} onOpenChange={setShowWalletModal} />
        </div>
    );
}
