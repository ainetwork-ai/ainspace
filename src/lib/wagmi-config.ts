import { createConfig, http } from 'wagmi';
import { base } from 'wagmi/chains';
import { coinbaseWallet } from 'wagmi/connectors';

export const config = createConfig({
    chains: [base],
    connectors: [
        coinbaseWallet({
            appName: process.env.NEXT_PUBLIC_ONCHAINKIT_PROJECT_NAME || 'Base MiniApp',
            preference: 'all'
        })
    ],
    transports: {
        [base.id]: http()
    },
    ssr: true
});

declare module 'wagmi' {
    interface Register {
        config: typeof config;
    }
}
