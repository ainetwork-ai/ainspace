'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import ConnectWalletModal from '@/components/ConnectWalletModal';
import EmailLoginModal from '@/components/EmailLoginModal';
import { beginSsoLogin } from '@/lib/backend/sso';
import { hasSession } from '@/lib/backend/token-store';

export default function LoginPage() {
    const { isConnected, isConnecting } = useAccount();
    const router = useRouter();
    const [loginError, setLoginError] = useState<string | null>(null);
    const [ssoPending, setSsoPending] = useState(false);
    const [showButton, setShowButton] = useState(false);
    const [showWalletModal, setShowWalletModal] = useState(false);
    const [showEmailModal, setShowEmailModal] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => {
            setShowButton(true);
        }, 100);

        return () => clearTimeout(timer);
    }, []);

    // Redirect home if already logged in — wallet (wagmi) OR a stored backend
    // session (email/kiosk, EPIC20/EPIC18). The login page doesn't hydrate the
    // user store, so a wallet-less session can only be seen via token-store here;
    // without this an email user returning to /login is stuck on the login screen
    // despite holding a valid session.
    useEffect(() => {
        if (isConnecting) return;
        if (hasSession()) {
            router.push('/');
        }
    }, [isConnected, isConnecting, router]);

    return (
        <div className="flex h-screen w-full max-w-800 flex-col items-center justify-center gap-6 bg-[#B1E1FF]">
            <Image src="/login/logo.svg" alt="Login Background" className="z-10" width={190} height={108} />
            <button
                onClick={async () => {
                    setLoginError(null); setSsoPending(true);
                    try { await beginSsoLogin(); }
                    catch { setLoginError('로그인을 시작하지 못했습니다. 다시 시도해 주세요.'); setSsoPending(false); }
                }}
                disabled={ssoPending}
                className="z-10 inline-flex h-14 w-[220px] items-center justify-center rounded bg-[#7f4fe8] font-medium text-white disabled:opacity-60"
            >{ssoPending ? '로그인 연결 중…' : 'AIN SSO로 로그인'}</button>
            {loginError && <p role="alert" className="z-10 text-sm text-red-700">{loginError}</p>}
            <div
                className={cn(
                    'z-10 h-14 transition-all duration-700 ease-out',
                    showButton ? 'opacity-100' : 'opacity-0'
                )}
            >
                <button
                    onClick={() => setShowWalletModal(true)}
                    className="z-10 inline-flex h-14 w-[180px] cursor-pointer items-center justify-center self-center rounded border border-[#7f4fe8] bg-white/70 text-[#7f4fe8] font-medium"
                >
                    Base / Wallet로 로그인
                </button>
            </div>
            <div
                className={cn(
                    'z-10 h-12 transition-all duration-700 ease-out',
                    showButton ? 'opacity-100' : 'opacity-0'
                )}
            >
                <button
                    onClick={() => setShowEmailModal(true)}
                    className="z-10 inline-flex h-12 w-[180px] cursor-pointer items-center justify-center self-center rounded border border-[#7f4fe8] bg-white/70 text-[#7f4fe8] font-medium"
                >
                    Continue with Email
                </button>
            </div>
            <Image src="/login/ainetwork.svg" alt="ainetwork" className="z-10" width={133} height={22} />
            <div className="h-10" />
            <div className="fixed bottom-0 flex w-full justify-center">
                <Image src="/login/login_background.png" alt="Login Background" width={600} height={1000} />
            </div>
            <ConnectWalletModal open={showWalletModal} onOpenChange={setShowWalletModal} />
            <EmailLoginModal
                open={showEmailModal}
                onOpenChange={setShowEmailModal}
                onSuccess={() => {
                    setShowEmailModal(false);
                    router.push('/');
                }}
            />
        </div>
    );
}
