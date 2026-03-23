import { useCallback, useEffect, useRef, useState } from 'react';

export function useCopyAddress(address: string | undefined) {
    const [isCopied, setIsCopied] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleCopy = useCallback(async () => {
        if (!address) return;
        await navigator.clipboard.writeText(address);
        setIsCopied(true);
        timerRef.current = setTimeout(() => setIsCopied(false), 2000);
    }, [address]);

    useEffect(() => {
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, []);

    return { isCopied, handleCopy };
}
