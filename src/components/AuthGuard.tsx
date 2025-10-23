'use client';

import { useAccount } from 'wagmi';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export function AuthGuard({ children }: { children: React.ReactNode }) {
    const { isConnected, isConnecting } = useAccount();
    const pathname = usePathname();
    const router = useRouter();
    const [isMounted, setIsMounted] = useState(false);

    const requiresAuth = pathname === '/';

    useEffect(() => {
        if (!requiresAuth) {
            return;
        }

        if (isConnecting) {
            console.log('Wagmi is checking wallet connection...');
            return;
        }

        console.log('Wagmi check complete. isConnected:', isConnected);

        if (!isConnected) {
            console.log('Wallet not connected, redirecting to /login');
            router.push('/login');
        } else {
            console.log('Wallet connected, allowing access');
        }
    }, [isConnected, isConnecting, pathname, requiresAuth, router]);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    if (!isMounted) {
        return null;
    }

    if (requiresAuth && isConnecting) {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-gray-100">
                <div className="text-center">
                    <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent motion-reduce:animate-[spin_1.5s_linear_infinite]"></div>
                    <p className="text-gray-600">Checking wallet connection...</p>
                </div>
            </div>
        );
    }

    return <>{children}</>;
}
