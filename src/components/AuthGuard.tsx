'use client';

import { useAccount } from 'wagmi';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';
import * as Sentry from '@sentry/nextjs';

export function AuthGuard({ children }: { children: React.ReactNode }) {
    const { isConnected, isConnecting, address } = useAccount();
    const pathname = usePathname();
    const router = useRouter();
    const [isMounted, setIsMounted] = useState(false);
    const redirectAttemptedRef = useRef(false);
    const lastStateRef = useRef({ isConnected, isConnecting, pathname });

    const requiresAuth = pathname === '/';

    useEffect(() => {
        // Log state changes
        const stateChanged =
            lastStateRef.current.isConnected !== isConnected ||
            lastStateRef.current.isConnecting !== isConnecting ||
            lastStateRef.current.pathname !== pathname;

        if (stateChanged) {
            Sentry.addBreadcrumb({
                category: 'auth',
                message: 'AuthGuard state changed',
                level: 'info',
                data: {
                    pathname,
                    requiresAuth,
                    isConnected,
                    isConnecting,
                    address: address || 'none',
                    isMounted,
                    redirectAttempted: redirectAttemptedRef.current,
                    previousState: lastStateRef.current,
                }
            });

            // Reset redirect flag when pathname changes
            if (lastStateRef.current.pathname !== pathname) {
                redirectAttemptedRef.current = false;
                Sentry.addBreadcrumb({
                    category: 'auth',
                    message: 'Pathname changed, reset redirect flag',
                    level: 'info',
                    data: {
                        from: lastStateRef.current.pathname,
                        to: pathname
                    }
                });
            }

            lastStateRef.current = { isConnected, isConnecting, pathname };
        }

        if (!requiresAuth) {
            Sentry.addBreadcrumb({
                category: 'auth',
                message: 'Page does not require auth',
                level: 'info',
                data: { pathname }
            });
            return;
        }

        if (isConnecting) {
            Sentry.addBreadcrumb({
                category: 'auth',
                message: 'Wallet connection check in progress',
                level: 'info',
                data: { pathname }
            });
            console.log('Wagmi is checking wallet connection...');
            return;
        }

        console.log('Wagmi check complete. isConnected:', isConnected);

        if (!isConnected) {
            // Don't redirect if already on login page
            if (pathname === '/login') {
                Sentry.addBreadcrumb({
                    category: 'auth',
                    message: 'Already on login page, skipping redirect',
                    level: 'info',
                    data: { pathname }
                });
                return;
            }

            if (!redirectAttemptedRef.current) {
                redirectAttemptedRef.current = true;

                Sentry.captureMessage('Redirecting to login - wallet not connected', {
                    level: 'info',
                    tags: {
                        component: 'AuthGuard',
                        action: 'redirect_to_login',
                    },
                    extra: {
                        pathname,
                        address: address || 'none',
                        isConnecting,
                        isMounted,
                    }
                });

                console.log('Wallet not connected, redirecting to /login');
                router.push('/login');
            } else {
                // Multiple redirect attempts detected
                Sentry.captureMessage('Multiple redirect attempts detected', {
                    level: 'warning',
                    tags: {
                        component: 'AuthGuard',
                        error_type: 'infinite_redirect',
                    },
                    extra: {
                        pathname,
                        isConnected,
                        isConnecting,
                        address: address || 'none',
                    }
                });
                console.warn('Redirect already attempted, preventing loop');
            }
        } else {
            redirectAttemptedRef.current = false;

            Sentry.addBreadcrumb({
                category: 'auth',
                message: 'Wallet connected, access granted',
                level: 'info',
                data: {
                    pathname,
                    address: address || 'none',
                }
            });

            console.log('Wallet connected, allowing access');
        }
    }, [isConnected, isConnecting, pathname, requiresAuth, router]);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    if (!isMounted) {
        Sentry.addBreadcrumb({
            category: 'auth',
            message: 'Component not mounted yet',
            level: 'info',
        });
        return null;
    }

    if (requiresAuth && isConnecting) {
        Sentry.addBreadcrumb({
            category: 'auth',
            message: 'Rendering loading spinner',
            level: 'info',
            data: { pathname, requiresAuth, isConnecting }
        });
        return (
            <div className="flex h-screen w-full items-center justify-center bg-gray-100">
                <div className="text-center">
                    <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent motion-reduce:animate-[spin_1.5s_linear_infinite]"></div>
                    <p className="text-gray-600">Checking wallet connection...</p>
                </div>
            </div>
        );
    }

    // Don't render children if auth is required but user is not connected
    if (requiresAuth && !isConnected) {
        Sentry.addBreadcrumb({
            category: 'auth',
            message: 'Not rendering children - auth required but not connected',
            level: 'info',
            data: {
                pathname,
                requiresAuth,
                isConnected,
                isConnecting,
                redirectAttempted: redirectAttemptedRef.current
            }
        });
        return null;
    }

    Sentry.addBreadcrumb({
        category: 'auth',
        message: 'Rendering children',
        level: 'info',
        data: {
            pathname,
            requiresAuth,
            isConnected,
            address: address || 'none'
        }
    });

    return <>{children}</>;
}
