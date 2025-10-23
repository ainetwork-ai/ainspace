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
    }
};

export default nextConfig;
