import { createConfig, http } from 'wagmi';
import { base, baseSepolia } from 'wagmi/chains';
import { baseAccount, coinbaseWallet, injected } from 'wagmi/connectors';

export const config = createConfig({
    chains: [base, baseSepolia],
    connectors: [
        baseAccount({
            appName: process.env.NEXT_PUBLIC_ONCHAINKIT_PROJECT_NAME || 'AINSpace',
        }),
        injected(),
        coinbaseWallet({
            appName: process.env.NEXT_PUBLIC_ONCHAINKIT_PROJECT_NAME || 'AINSpace',
            preference: { options: 'all' }
        })
    ],
    transports: {
        [base.id]: http(),
        [baseSepolia.id]: http(),
    },
    ssr: true
});

declare module 'wagmi' {
    interface Register {
        config: typeof config;
    }
}
