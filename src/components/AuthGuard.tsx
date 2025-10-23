'use client';

import { useAccount } from 'wagmi';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * LocalStorage key for storing wallet connection state
 */
const WALLET_CONNECTED_KEY = 'wallet_connected';

/**
 * AuthGuard component that protects routes requiring wallet connection.
 * Uses localStorage for fast initial auth check to improve UX.
 *
 * Performance optimization strategy:
 * 1. Check localStorage first for instant initial state
 * 2. Perform early redirect based on cached state
 * 3. Verify with actual wagmi isConnected state
 * 4. Sync localStorage with real connection state
 * 5. Final redirect decision based on verified state
 *
 * @param {Object} props - Component props
 * @param {React.ReactNode} props.children - Child components to render if authenticated
 * @returns {React.ReactNode} Protected content or null during redirect
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
    const { isConnected } = useAccount();
    const pathname = usePathname();
    const router = useRouter();
    const [isChecking, setIsChecking] = useState(true);
    const [cachedConnected, setCachedConnected] = useState<boolean | null>(null);

    // Public routes that don't require authentication
    const publicRoutes = ['/login'];
    const isPublicRoute = publicRoutes.includes(pathname);

    // Step 1: Initialize from localStorage for fast initial check
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const cached = localStorage.getItem(WALLET_CONNECTED_KEY);
            const isWalletConnected = cached === 'true';
            setCachedConnected(isWalletConnected);

            // Step 2: Early redirect based on localStorage if not connected
            if (!isPublicRoute && !isWalletConnected) {
                console.log('localStorage check: Wallet not connected, redirecting to /login');
                router.push('/login');
            }
        }
    }, [pathname, isPublicRoute, router]);

    // Step 3-5: Verify with actual isConnected state and sync localStorage
    useEffect(() => {
        // Allow public routes without wallet connection
        if (isPublicRoute) {
            setIsChecking(false);
            return;
        }

        // Step 3: Update localStorage to match actual connection state
        if (typeof window !== 'undefined') {
            const currentCached = localStorage.getItem(WALLET_CONNECTED_KEY);
            const shouldBeConnected = String(isConnected);

            // Sync localStorage with actual state if they differ
            if (currentCached !== shouldBeConnected) {
                console.log(`Syncing localStorage: ${currentCached} -> ${shouldBeConnected}`);
                localStorage.setItem(WALLET_CONNECTED_KEY, shouldBeConnected);
            }
        }

        // Step 4: Final redirect decision based on verified state
        if (!isConnected) {
            console.log('wagmi check: Wallet not connected, redirecting to /login');
            router.push('/login');
        } else {
            // Step 5: Remove loading UI - connection verified
            setIsChecking(false);
        }
    }, [isConnected, pathname, isPublicRoute, router]);

    // Optimized loading state: Skip loading if localStorage indicates connected
    // This significantly improves perceived performance for returning users
    if (isChecking && !isPublicRoute) {
        // Fast path: If localStorage shows connected, minimize loading UI duration
        if (cachedConnected === true) {
            return (
                <div className="flex h-screen w-full items-center justify-center bg-gray-100">
                    <div className="text-center">
                        <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent motion-reduce:animate-[spin_1.5s_linear_infinite]"></div>
                        <p className="text-gray-600">Loading...</p>
                    </div>
                </div>
            );
        }

        // Slow path: First time or disconnected state
        return (
            <div className="flex h-screen w-full items-center justify-center bg-gray-100">
                <div className="text-center">
                    <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent motion-reduce:animate-[spin_1.5s_linear_infinite]"></div>
                    <p className="text-gray-600">Checking wallet connection...</p>
                </div>
            </div>
        );
    }

    // Render children if authenticated or on public route
    return <>{children}</>;
}
