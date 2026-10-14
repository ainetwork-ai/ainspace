import { BackendUser, VerifyResponse } from '@/types/backend';
import { PUBLIC_BACKEND_BASE_URL, PUBLIC_BACKEND_CLIENT_ID } from './public-config';
import { setSession, setEmailFlag, setKioskFlag, setSsoFlag } from './token-store';

const PENDING_KEY = 'ainspace-sso-pending';
const MAX_AGE = 10 * 60 * 1000;
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** PKCE binds the single-use Teams handoff to the browser which started login. */
export async function beginSsoLogin(): Promise<void> {
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ verifier, state, createdAt: Date.now() }));
    const start = new URL('/api/auth/sso/external/start', process.env.NEXT_PUBLIC_AIN_TEAMS_URL || 'https://ainteams.ainetwork.ai');
    start.searchParams.set('clientId', PUBLIC_BACKEND_CLIENT_ID);
    start.searchParams.set('redirectUri', `${window.location.origin}/login/sso`);
    start.searchParams.set('state', state);
    start.searchParams.set('codeChallenge', challenge);
    window.location.assign(start.href);
}

export async function completeSsoLogin(params: URLSearchParams): Promise<BackendUser> {
    const raw = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    if (!raw) throw new Error('로그인 요청이 만료되었습니다. 다시 로그인해 주세요.');
    const pending = JSON.parse(raw) as { verifier: string; state: string; createdAt: number };
    if (params.get('state') !== pending.state || !Number.isFinite(pending.createdAt) || Date.now() - pending.createdAt > MAX_AGE || pending.createdAt > Date.now()) {
        throw new Error('로그인 요청을 확인할 수 없습니다. 다시 로그인해 주세요.');
    }
    if (params.has('error')) throw new Error('AIN SSO 로그인을 완료하지 못했습니다. 다시 시도해 주세요.');
    const code = params.get('code');
    if (!code) throw new Error('로그인 코드가 없습니다. 다시 로그인해 주세요.');
    const response = await fetch(`${PUBLIC_BACKEND_BASE_URL}/auth/sso/external/exchange`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, verifier: pending.verifier, clientId: PUBLIC_BACKEND_CLIENT_ID, redirectUri: `${window.location.origin}/login/sso` }),
        signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('AIN SSO 세션을 연결하지 못했습니다. 다시 로그인해 주세요.');
    const { user, tokens } = await response.json() as VerifyResponse;
    setSession(user, tokens); setKioskFlag(false); setEmailFlag(false); setSsoFlag(true);
    return user;
}
