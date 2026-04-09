'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAccount, useConnect, useSignMessage } from 'wagmi';
import { useRouter } from 'next/navigation';
import { cn, shortAddress } from '@/lib/utils';

export default function LoginPage() {
    const { address, isConnected, isConnecting } = useAccount();
    const { connect, connectors } = useConnect();
    const { signMessageAsync } = useSignMessage();
    const router = useRouter();
    const [nonce] = useState(() => Date.now().toString());
    const message = useMemo(() => `Welcome to the AINSpace MiniApp!\n\nNonce: ${nonce}`, [nonce]);
    const [showButton, setShowButton] = useState(false);
    const [buttonState, setButtonState] = useState<'idle' | 'signing' | 'success' | 'error'>('idle');

    useEffect(() => {
        const timer = setTimeout(() => {
            setShowButton(true);
        }, 100);

        return () => clearTimeout(timer);
    }, []);

    // Redirect to home page if wallet is already connected
    // Only redirect after wagmi finishes checking connection status
    useEffect(() => {
        // Wait for wagmi to finish loading
        if (isConnecting) {
            console.log('Wagmi is still connecting, waiting before redirect...');
            return;
        }

        // wagmi has finished checking, now redirect if connected
        if (isConnected) {
            console.log('Wallet connected (final check), redirecting to home page');
            router.push('/');
        }
    }, [isConnected, isConnecting, router]);

    const handleConnect = useCallback(async () => {
        if (buttonState === 'signing') return;

        if (!isConnected) {
            // Connect wallet first
            connect({ connector: connectors[0] });
            return;
        }

        // Already connected, sign message
        setButtonState('signing');
        try {
            const signature = await signMessageAsync({ message });
            if (signature && address) {
                console.log('Signature received:', signature);
                setButtonState('success');
            }
        } catch {
            setButtonState('error');
        }
    }, [isConnected, connect, connectors, signMessageAsync, message, address, buttonState]);

    const buttonLabel = useMemo(() => {
        switch (buttonState) {
            case 'signing': return 'Signing...';
            case 'success': return address ? shortAddress(address) : 'Connect Wallet';
            case 'error': return 'Try Again';
            default: return 'Connect Wallet';
        }
    }, [buttonState, address]);

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
                    onClick={handleConnect}
                    disabled={buttonState === 'signing'}
                    className="z-10 inline-flex h-14 w-[180px] cursor-pointer items-center justify-center self-center rounded bg-[#7f4fe8] text-white font-medium disabled:opacity-50"
                >
                    {buttonLabel}
                </button>
            </div>
            <Image src="/login/ainetwork.svg" alt="ainetwork" className="z-10" width={133} height={22} />
            <div className="h-10" />
            <div className="fixed bottom-0 flex w-full justify-center">
                <Image src="/login/login_background.png" alt="Login Background" width={600} height={1000} />
            </div>
        </div>
    );
}
