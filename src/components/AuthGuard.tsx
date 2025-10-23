'use client';

import { useAccount } from 'wagmi';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * AuthGuard component that protects routes requiring wallet connection.
 * Redirects to /login if wallet is not connected.
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

    // Only check authentication on the root path "/"
    const requiresAuth = pathname === '/';

<<<<<<< Updated upstream
=======
    // Step 1: Initialize from localStorage for fast initial check
    useEffect(() => {
        if (!requiresAuth) {
            setIsChecking(false);
            return;
        }

        if (typeof window !== 'undefined') {
            const cached = localStorage.getItem(WALLET_CONNECTED_KEY);
            const isWalletConnected = cached === 'true';
            setCachedConnected(isWalletConnected);

            // Step 2: Early redirect based on localStorage if not connected
            if (!isWalletConnected) {
                console.log('localStorage check: Wallet not connected, redirecting to /login');
                router.push('/login');
            }
        }
    }, [pathname, requiresAuth, router]);

    // Step 3-5: Verify with actual isConnected state and sync localStorage
>>>>>>> Stashed changes
    useEffect(() => {
        // Skip auth check if not on root path
        if (!requiresAuth) {
            setIsChecking(false);
            return;
        }

        // Redirect to login if wallet is not connected on protected routes
        if (!isConnected) {
            console.log('Wallet not connected, redirecting to /login');
            router.push('/login');
        } else {
            setIsChecking(false);
        }
    }, [isConnected, pathname, requiresAuth, router]);

<<<<<<< Updated upstream
    // Show loading state while checking authentication
    // This prevents flash of protected content before redirect
    if (isChecking && !isPublicRoute) {
=======
    // Optimized loading state: Skip loading if not requiring auth
    if (isChecking && requiresAuth) {
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
>>>>>>> Stashed changes
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
