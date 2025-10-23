'use client';

import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { base } from 'viem/chains';
import { OnchainKitProvider } from '@coinbase/onchainkit';
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
        if (mounted && window?.ethereum) {
            window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: BASE_CHAIN_ID }]
            });
        }
    }, [mounted]);

    return (
        <WagmiProvider config={config}>
            <QueryClientProvider client={queryClient}>
                <MapDataProvider>
                    <OnchainKitProvider
                        apiKey={process.env.NEXT_PUBLIC_ONCHAINKIT_API_KEY!}
                        chain={base}
                        miniKit={{
                            enabled: true,
                            autoConnect: true
                        }}
                        config={{
                            appearance: {
                                mode: 'auto',
                                theme: 'mini-app-theme',
                                name: process.env.NEXT_PUBLIC_ONCHAINKIT_PROJECT_NAME,
                                logo: process.env.NEXT_PUBLIC_APP_ICON
                            },
                            wallet: {
                                display: 'classic'
                            }
                        }}
                    >
                        {children}
                    </OnchainKitProvider>
                </MapDataProvider>
            </QueryClientProvider>
        </WagmiProvider>
    );
}
