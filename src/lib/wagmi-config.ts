import { createConfig, http } from 'wagmi';
import { base, baseSepolia } from 'wagmi/chains';
import { baseAccount, injected } from 'wagmi/connectors';

export const config = createConfig({
    chains: [base, baseSepolia],
    connectors: [
        baseAccount({
            appName: process.env.NEXT_PUBLIC_ONCHAINKIT_PROJECT_NAME || 'AINSpace',
        }),
        injected(),
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
