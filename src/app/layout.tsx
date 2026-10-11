import './globals.css';
import { Providers } from '@/providers/Providers';
import { AuthGuard } from '@/components/AuthGuard';
import { Analytics } from '@vercel/analytics/next';
import { GoogleAnalytics } from '@/components/GoogleAnalytics';
import type { Metadata } from 'next';

// Use local font files to avoid network dependency during build
// Ensure you have the font files in /public/fonts or use a local font package
// For now, we rely on CSS fallbacks defined in globals.css if fonts are missing
// To fully fix this, you should download the font files and place them in /public/fonts
// and update the CSS to use @font-face with local files, or use a package like @fontsource/geist

// Placeholder for font variables if using local fonts via CSS
// If you want to use next/font with local files, you need to import them differently
// For now, we remove the google font imports to prevent build failure
// The CSS fallbacks in globals.css will handle the rendering

const geistSans = { variable: 'font-sans' }; // Fallback class
const geistMono = { variable: 'font-mono' }; // Fallback class
const manrope = { variable: 'font-manrope' }; // Fallback class

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
          'base:app_id': '69d737baadb751d63e3ce6a8',
        },
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
                    content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover, interactive-widget=overlays-content"
                />
            </head>
            <body className={`${geistSans.variable} ${geistMono.variable} ${manrope.variable} antialiased`} suppressHydrationWarning>
                <Providers>
                    <AuthGuard>{children}</AuthGuard>
                </Providers>
                <GoogleAnalytics />
                <Analytics />
            </body>
        </html>
    );
}
