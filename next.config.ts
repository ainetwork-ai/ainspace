import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    images: {
        remotePatterns: [
            {
                protocol: 'https',
                hostname: '**.public.blob.vercel-storage.com'
            }
        ]
    },
    async redirects() {
        return [
            {
                source: '/.well-known/farcaster.json',
                destination: 'https://api.farcaster.xyz/miniapps/hosted-manifest/019a114e-1634-dc03-113d-a160b96edd0a',
                permanent: false
            }
        ];
    },
    webpack: (config, { dev, isServer }) => {
        // Production 환경에서만 console.log 제거 (console.error, console.warn은 유지)
        if (!dev && !isServer) {
            // terser 옵션 설정
            config.optimization.minimizer = config.optimization.minimizer.map((plugin: any) => {
                if (plugin.constructor.name === 'TerserPlugin') {
                    plugin.options.terserOptions = {
                        ...plugin.options.terserOptions,
                        compress: {
                            ...plugin.options.terserOptions?.compress,
                            pure_funcs: ['console.log'], // console.log만 제거
                        }
                    };
                }
                return plugin;
            });
        }

        // 브라우저에서 필요 없는 모듈들을 false로 설정하여 경고 제거
        config.resolve.fallback = {
            ...config.resolve.fallback,
            '@react-native-async-storage/async-storage': false,
            'pino-pretty': false,
            'lokijs': false,
            'encoding': false,
        };

        return config;
    }
};

export default nextConfig;
