'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { completeSsoLogin } from '@/lib/backend/sso';
import { useUserStore } from '@/stores';

export default function SsoCallbackPage() {
    const started = useRef(false);
    const [error, setError] = useState<string | null>(null);
    const router = useRouter();
    useEffect(() => {
        if (started.current) return;
        started.current = true;
        const params = new URLSearchParams(window.location.search);
        window.history.replaceState(null, '', '/login/sso');
        completeSsoLogin(params).then(user => {
            useUserStore.getState().setBackendAuth(user);
            router.replace('/');
        }).catch(() => setError('AIN SSO 로그인을 완료하지 못했습니다. 다시 로그인해 주세요.'));
    }, [router]);
    return <main className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p role={error ? 'alert' : 'status'}>{error || 'AIN SSO 로그인 연결 중…'}</p>
        {error && <Link href="/login" className="rounded bg-[#7f4fe8] px-5 py-3 text-white">다시 로그인</Link>}
    </main>;
}
