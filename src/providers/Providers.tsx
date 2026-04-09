'use client';

import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { config } from '@/lib/wagmi-config';
import { MapDataProvider } from './MapDataProvider';
import { useEffect, useState } from 'react';


const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 60 * 1000,
            retry: 1
        }
    }
});

export function Providers({ children }: { children: React.ReactNode }) {
    const [mounted, setMounted] = useState(false);
    const BASE_CHAIN_ID = '0x2105';

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        const ethereum = (window as unknown as { ethereum?: { request: (args: { method: string; params: unknown[] }) => Promise<unknown> } }).ethereum;
        if (mounted && ethereum) {
            ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: BASE_CHAIN_ID }]
            });
        }
    }, [mounted]);

    return (
        <WagmiProvider config={config}>
            <QueryClientProvider client={queryClient}>
                <MapDataProvider>
                    {children}
                </MapDataProvider>
            </QueryClientProvider>
        </WagmiProvider>
    );
}
