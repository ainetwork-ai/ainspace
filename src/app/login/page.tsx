'use client';

import Image from 'next/image';
import { Signature, SignatureButton } from '@coinbase/onchainkit/signature';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import { cn, shortAddress } from '@/lib/utils';

export default function LoginPage() {
    const { address, isConnected } = useAccount();
    const [nonce] = useState(() => Date.now().toString());
    const message = useMemo(() => `Welcome to the AIN SPACE MiniApp!\n\nNonce: ${nonce}`, [nonce]);
    const [showButton, setShowButton] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => {
            setShowButton(true);
        }, 100);

        return () => clearTimeout(timer);
    }, []);

    const handleSignature = useCallback(
        async (signature: string) => {
            if (!signature || !address) return;
        },
        [address, message]
    );

    const ConnectWalletButton = () => {
        return (
            <div className={cn('h-14 transition-all duration-700 ease-out', showButton ? 'opacity-100' : 'opacity-0')}>
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
            <Image src="/login/logo.svg" alt="Login Background" width={190} height={108} />
            <ConnectWalletButton />
            <Image src="/login/ainetwork.svg" alt="ainetwork" className="z-10" width={133} height={22} />
            <div className="h-10" />
            <div className="fixed bottom-0 flex w-full justify-center">
                <Image src="/login/login_background.png" alt="Login Background" width={600} height={1000} />
            </div>
        </div>
    );
}
