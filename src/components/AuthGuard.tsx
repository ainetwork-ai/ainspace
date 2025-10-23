'use client';

import { useAccount } from 'wagmi';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const WALLET_CONNECTED_KEY = 'wallet_connected';

export function AuthGuard({ children }: { children: React.ReactNode }) {
    const { isConnected, isConnecting } = useAccount();
    const pathname = usePathname();
    const router = useRouter();
    const [isMounted, setIsMounted] = useState(false);

    const [isInitialCheck, setIsInitialCheck] = useState(true);
    const [cachedConnected, setCachedConnected] = useState<boolean | null>(null);

    const requiresAuth = pathname === '/';

    useEffect(() => {
        if (!requiresAuth) {
            setIsInitialCheck(false);
            return;
        }
        if (typeof window !== 'undefined') {
            const cached = localStorage.getItem(WALLET_CONNECTED_KEY);
            const isWalletConnected = cached === 'true';
            setCachedConnected(isWalletConnected);
            console.log('localStorage hint:', isWalletConnected ? 'connected' : 'not connected');
        }
    }, [pathname, requiresAuth]);

    useEffect(() => {
        if (!requiresAuth) {
            setIsInitialCheck(false);
            return;
        }

        if (isConnecting) {
            console.log('Wagmi is still connecting, waiting...');
            return;
        }

        console.log('Wagmi check complete. isConnected:', isConnected);

        if (typeof window !== 'undefined') {
            const currentCached = localStorage.getItem(WALLET_CONNECTED_KEY);
            const shouldBeConnected = String(isConnected);

            if (currentCached !== shouldBeConnected) {
                console.log(`Syncing localStorage: ${currentCached} -> ${shouldBeConnected}`);
                localStorage.setItem(WALLET_CONNECTED_KEY, shouldBeConnected);
            }
        }

        if (!isConnected) {
            console.log('Wallet not connected (final check), redirecting to /login');
            router.push('/login');
        } else {
            console.log('Wallet connected (final check), allowing access');
            setIsInitialCheck(false);
        }
    }, [isConnected, isConnecting, pathname, requiresAuth, router]);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    if (!isMounted) {
        return null;
    }

    if (requiresAuth && (isConnecting || isInitialCheck)) {
        const loadingMessage =
            cachedConnected === true ? 'Restoring wallet connection...' : 'Checking wallet connection...';

        return (
            <div className="flex h-screen w-full items-center justify-center bg-gray-100">
                <div className="text-center">
                    <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent motion-reduce:animate-[spin_1.5s_linear_infinite]"></div>
                    <p className="text-gray-600">{loadingMessage}</p>
                </div>
            </div>
        );
    }

    return <>{children}</>;
}
