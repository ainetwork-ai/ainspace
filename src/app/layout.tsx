import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import '@coinbase/onchainkit/styles.css';
import { Providers } from '@/providers/Providers';
import { AuthGuard } from '@/components/AuthGuard';
import { Analytics } from '@vercel/analytics/next';
import type { Metadata } from 'next';

const geistSans = Geist({
    variable: '--font-geist-sans',
    subsets: ['latin']
});

const geistMono = Geist_Mono({
    variable: '--font-geist-mono',
    subsets: ['latin']
});

export function generateMetadata(): Metadata {
    const baseUrl = process.env.NEXT_PUBLIC_URL || 'https://ainspace-4g3e.vercel.app';
    const projectName = process.env.NEXT_PUBLIC_ONCHAINKIT_PROJECT_NAME || 'AINSPACE';
    const description =
        process.env.NEXT_PUBLIC_ONCHAINKIT_PROJECT_DESCRIPTION ||
        'AI agents autonomously interact in a virtual village, forging relationships and a unique society';

    return {
        metadataBase: new URL(baseUrl),
        title: {
            default: process.env.NEXT_PUBLIC_ENV === 'production' ? projectName : `${projectName} - DEV`,
            template: `%s | ${projectName}`
        },
        description,
        keywords: [
            'Web3',
            'blockchain',
            'crypto',
            'Base',
            'onchain',
            'miniapp',
            'Farcaster',
            'rewards',
            'missions',
            'AI Network',
            'KKAEBI',
            'AINSpace'
        ],
        authors: [{ name: 'AI Network', url: baseUrl }],
        creator: 'AI Network',
        publisher: 'AI Network',
        formatDetection: {
            email: false,
            address: false,
            telephone: false
        },
        alternates: {
            canonical: baseUrl
        },
        openGraph: {
            type: 'website',
            locale: 'en_US',
            url: baseUrl,
            siteName: projectName,
            title: projectName,
            description,
            images: [
                {
                    url: process.env.NEXT_PUBLIC_APP_OG_IMAGE!,
                    width: 1200,
                    height: 630,
                    alt: projectName,
                    type: 'image/png'
                }
            ]
        },
        twitter: {
            card: 'summary_large_image',
            site: '@common_ai',
            creator: '@common_ai',
            title: projectName,
            description,
            images: [process.env.NEXT_PUBLIC_APP_OG_IMAGE!]
        },
        robots: {
            index: true,
            follow: true,
            nocache: false,
            googleBot: {
                index: true,
                follow: true,
                noimageindex: false,
                'max-video-preview': -1,
                'max-image-preview': 'large',
                'max-snippet': -1
            }
        },
        other: {
            'fc:frame': JSON.stringify({
                version: 'next',
                imageUrl: process.env.NEXT_PUBLIC_APP_OG_IMAGE,
                button: {
                    title: `Launch ${projectName}`,
                    action: {
                        type: 'launch_frame',
                        name: projectName,
                        url: baseUrl,
                        splashImageUrl: process.env.NEXT_PUBLIC_SPLASH_IMAGE,
                        splashBackgroundColor: process.env.NEXT_PUBLIC_SPLASH_BACKGROUND_COLOR
                    }
                }
            })
        },
        manifest: '/.well-known/farcaster.json'
    };
}

export default function RootLayout({
    children
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" suppressHydrationWarning>
            <head>
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover"
                />
            </head>
            <body className={`${geistSans.variable} ${geistMono.variable} antialiased`} suppressHydrationWarning>
                <Providers>
                    <AuthGuard>{children}</AuthGuard>
                </Providers>
                <Analytics />
            </body>
        </html>
    );
}
