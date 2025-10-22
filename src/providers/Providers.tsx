'use client';

import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { base } from 'viem/chains';
import { MiniKitProvider } from '@coinbase/onchainkit/minikit';
import { config } from '@/lib/wagmi-config';
import { MapDataProvider } from './MapDataProvider';

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 60 * 1000, // 1 minute
            retry: 1
        }
    }
});

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <WagmiProvider config={config}>
            <QueryClientProvider client={queryClient}>
                <MapDataProvider>
                    <MiniKitProvider
                        apiKey={process.env.NEXT_PUBLIC_ONCHAINKIT_API_KEY!}
                        chain={base}
                        autoConnect={false}
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
                    </MiniKitProvider>
                </MapDataProvider>
            </QueryClientProvider>
        </WagmiProvider>
    );
}
