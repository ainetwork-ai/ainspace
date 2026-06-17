import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

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
            // wagmi's connector barrel re-exports every connector; we only use
            // baseAccount + injected, so stub the unused connectors' optional peer
            // deps (they aren't installed). Same rationale as the modules above.
            'accounts': false, // Tempo connector
            '@metamask/connect-evm': false, // metaMask connector
            '@safe-global/safe-apps-sdk': false, // safe connector
            '@safe-global/safe-apps-provider': false, // safe connector
            '@walletconnect/ethereum-provider': false, // walletConnect connector
        };

        return config;
    }
};

// Injected content via Sentry wizard below

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "comcom-xr",

  project: "ainspace",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Uncomment to route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  // tunnelRoute: "/monitoring",

  // Automatically tree-shake Sentry logger statements to reduce bundle size
  disableLogger: true,

  // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
  // See the following for more information:
  // https://docs.sentry.io/product/crons/
  // https://vercel.com/docs/cron-jobs
  automaticVercelMonitors: true
});