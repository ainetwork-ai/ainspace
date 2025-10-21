import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { MapDataProvider } from '@/providers/MapDataProvider';

const geistSans = Geist({
    variable: '--font-geist-sans',
    subsets: ['latin']
});

const geistMono = Geist_Mono({
    variable: '--font-geist-mono',
    subsets: ['latin']
});

export default function RootLayout({
    children
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" suppressHydrationWarning>
            <head>
                <title>Ainspace</title>
                <meta name="description" content="AI-powered collaborative space" />
            </head>
            <body className={`${geistSans.variable} ${geistMono.variable} antialiased`} suppressHydrationWarning>
                <MapDataProvider>{children}</MapDataProvider>
            </body>
        </html>
    );
}
