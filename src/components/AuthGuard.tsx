'use client';

import { useAccount } from 'wagmi';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const WALLET_CONNECTED_KEY = 'wallet_connected';

export function AuthGuard({ children }: { children: React.ReactNode }) {
    const { isConnected, isConnecting } = useAccount();
    const pathname = usePathname();
    const router = useRouter();
    const [isInitialCheck, setIsInitialCheck] = useState(true);
    const [cachedConnected, setCachedConnected] = useState<boolean | null>(null);

    const requiresAuth = pathname === '/';

    // Initial localStorage check (for UI hint only)
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

    // Main authentication logic - only runs after wagmi finishes loading
    useEffect(() => {
        if (!requiresAuth) {
            setIsInitialCheck(false);
            return;
        }

        // Wait for wagmi to finish checking connection status
        if (isConnecting) {
            console.log('Wagmi is still connecting, waiting...');
            return;
        }

        // wagmi has finished checking, now we have the final state
        console.log('Wagmi check complete. isConnected:', isConnected);

        // Sync localStorage with actual wagmi state
        if (typeof window !== 'undefined') {
            const currentCached = localStorage.getItem(WALLET_CONNECTED_KEY);
            const shouldBeConnected = String(isConnected);

            if (currentCached !== shouldBeConnected) {
                console.log(`Syncing localStorage: ${currentCached} -> ${shouldBeConnected}`);
                localStorage.setItem(WALLET_CONNECTED_KEY, shouldBeConnected);
            }
        }

        // Make redirect decision based on final wagmi state
        if (!isConnected) {
            console.log('Wallet not connected (final check), redirecting to /login');
            router.push('/login');
        } else {
            console.log('Wallet connected (final check), allowing access');
            setIsInitialCheck(false);
        }
    }, [isConnected, isConnecting, pathname, requiresAuth, router]);

    // Show loading UI while wagmi is connecting or during initial check
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
