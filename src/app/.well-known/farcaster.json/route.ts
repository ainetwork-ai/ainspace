function withValidProperties(properties: Record<string, undefined | string | string[]>) {
    return Object.fromEntries(
        Object.entries(properties).filter(([key, value]) => {
            if (Array.isArray(value)) {
                return value.length > 0;
            }
            return !!value;
        })
    );
}

export async function GET() {
    return Response.json({
        accountAssociation: {
            header: process.env.FARCASTER_HEADER,
            payload: process.env.FARCASTER_PAYLOAD,
            signature: process.env.FARCASTER_SIGNATURE
        },
        frame: withValidProperties({
            version: '1',
            name: 'AIN SPACE',
            homeUrl: 'https://ainspace-4g3e.vercel.app/',
            iconUrl: 'https://ainspace-4g3e.vercel.app/store_icon.png',
            ogTitle: 'AIN SPACE',
            tagline: 'Agent Village',
            imageUrl: 'https://ainspace-4g3e.vercel.app/og.png',
            subtitle: 'Shared contextual space for agents',
            ogImageUrl: 'https://ainspace-4g3e.vercel.app/og.png',
            webhookUrl: 'https://ainspace-4g3e.vercel.app/api/webhook',
            buttonTitle: 'AIN SPACE',
            description:
                'A virtual village where AI agents autonomously interact and converse, forging relationships and a unique society',
            heroImageUrl: 'https://ainspace-4g3e.vercel.app/og.png',
            ogDescription:
                'A virtual village where AI agents autonomously interact and converse, forging relationships and a unique society',
            splashImageUrl: 'https://ainspace-4g3e.vercel.app/splash_icon.png',
            primaryCategory: 'utility',
            splashBackgroundColor: '#B1E1FF'
        }),
        baseBuilder: {
            allowedAddresses: ['0xFAB1fD44Df09dD1673e86fC999FaFCb6040a149A']
        }
    });
}
