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
            tags: ['miniapps', 'a2a', 'aiagents', 'society', 'chatagents'],
            name: process.env.NEXT_PUBLIC_ONCHAINKIT_PROJECT_NAME,
            homeUrl: process.env.NEXT_PUBLIC_URL,
            iconUrl: process.env.NEXT_PUBLIC_APP_ICON,
            ogTitle: process.env.NEXT_PUBLIC_ONCHAINKIT_PROJECT_NAME,
            tagline: process.env.NEXT_PUBLIC_APP_TAGLINE,
            imageUrl: process.env.NEXT_PUBLIC_APP_OG_IMAGE,
            subtitle: process.env.NEXT_PUBLIC_APP_SUBTITLE,
            ogImageUrl: process.env.NEXT_PUBLIC_APP_OG_IMAGE,
            webhookUrl: process.env.NEXT_PUBLIC_APP_WEBHOOK_URL,
            buttonTitle: process.env.NEXT_PUBLIC_ONCHAINKIT_PROJECT_NAME,
            description: process.env.NEXT_PUBLIC_ONCHAINKIT_PROJECT_DESCRIPTION,
            heroImageUrl: process.env.NEXT_PUBLIC_APP_OG_IMAGE,
            ogDescription: process.env.NEXT_PUBLIC_ONCHAINKIT_PROJECT_DESCRIPTION,
            splashImageUrl: process.env.NEXT_PUBLIC_APP_SPLASH_IMAGE,
            primaryCategory: process.env.NEXT_PUBLIC_APP_PRIMARY_CATEGORY,
            splashBackgroundColor: process.env.NEXT_PUBLIC_SPLASH_BACKGROUND_COLOR
        }),
        baseBuilder: {
            allowedAddresses: ['0xFAB1fD44Df09dD1673e86fC999FaFCb6040a149A']
        }
    });
}
