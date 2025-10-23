'use client';

import Image from 'next/image';
import { Signature, SignatureButton } from '@coinbase/onchainkit/signature';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import { useRouter } from 'next/navigation';
import { cn, shortAddress } from '@/lib/utils';

export default function LoginPage() {
    const { address, isConnected, isConnecting } = useAccount();
    const router = useRouter();
    const [nonce] = useState(() => Date.now().toString());
    const message = useMemo(() => `Welcome to the AIN SPACE MiniApp!\n\nNonce: ${nonce}`, [nonce]);
    const [showButton, setShowButton] = useState(false);

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

    const handleSignature = useCallback(
        async (signature: string) => {
            if (!signature || !address) return;

            console.log('Signature received:', signature);
            // After successful signature, user will be redirected via the useEffect above
        },
        [address]
    );

    const ConnectWalletButton = () => {
        return (
            <div
                className={cn(
                    'z-10 h-14 transition-all duration-700 ease-out',
                    showButton ? 'opacity-100' : 'opacity-0'
                )}
            >
                <Signature message={message} onSuccess={handleSignature}>
                    <SignatureButton
                        label="Wallet Login"
                        errorLabel="Try Again"
                        successLabel={address ? shortAddress(address) : 'Wallet Login'}
                        pendingLabel="Signing..."
                        className={
                            'z-10 inline-flex w-[180px] cursor-pointer items-center justify-center self-center rounded bg-[#7f4fe8]'
                        }
                    />
                </Signature>
            </div>
        );
    };

    return (
        <div className="flex h-screen w-full max-w-800 flex-col items-center justify-center gap-6 bg-[#B1E1FF]">
            <Image src="/login/logo.svg" alt="Login Background" className="z-10" width={190} height={108} />
            <ConnectWalletButton />
            <Image src="/login/ainetwork.svg" alt="ainetwork" className="z-10" width={133} height={22} />
            <div className="h-10" />
            <div className="fixed bottom-0 flex w-full justify-center">
                <Image src="/login/login_background.png" alt="Login Background" width={600} height={1000} />
            </div>
        </div>
    );
}
