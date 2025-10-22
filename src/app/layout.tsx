import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import '@coinbase/onchainkit/styles.css';
import { Providers } from '@/providers/Providers';
import type { Metadata } from 'next';

const geistSans = Geist({
    variable: '--font-geist-sans',
    subsets: ['latin']
});

const geistMono = Geist_Mono({
    variable: '--font-geist-mono',
    subsets: ['latin']
});

export const metadata: Metadata = {
    title: 'Ainspace',
    description: 'AI-powered collaborative space'
};

export default function RootLayout({
    children
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body className={`${geistSans.variable} ${geistMono.variable} antialiased`} suppressHydrationWarning>
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
