'use client';

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import * as Sentry from '@sentry/nextjs';

export function AuthGuard({ children }: { children: React.ReactNode }) {
    const { isConnecting } = useAccount();
    const [isMounted, setIsMounted] = useState(false);
    const [isHydrated, setIsHydrated] = useState(false);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    // Track hydration: wait for wagmi to finish initial connection check
    useEffect(() => {
        if (!isConnecting && isMounted) {
            const timer = setTimeout(() => {
                setIsHydrated(true);
                Sentry.addBreadcrumb({
                    category: 'auth',
                    message: 'App hydration complete',
                    level: 'info',
                });
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [isConnecting, isMounted]);

    if (!isMounted || !isHydrated) {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-gray-100">
                <div className="text-center">
                    <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent motion-reduce:animate-[spin_1.5s_linear_infinite]"></div>
                    <p className="text-gray-600">Loading...</p>
                </div>
            </div>
        );
    }

    return <>{children}</>;
}
