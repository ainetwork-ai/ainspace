import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { beginSsoLogin, completeSsoLogin } from './sso';
import { getSsoFlag, getAccessToken, clearSession } from './token-store';

const original = { window: globalThis.window, localStorage: globalThis.localStorage, sessionStorage: globalThis.sessionStorage, fetch: globalThis.fetch };
function storage() {
    const items = new Map<string, string>();
    return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); }, removeItem: (key: string) => { items.delete(key); } };
}
function browser() {
    let destination = '';
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'https://ainspace.example', assign: (url: string) => { destination = url; } } } });
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage() });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage() });
    return () => destination;
}
afterEach(() => { for (const [key, value] of Object.entries(original)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); });

test('SSO authorization sends only a challenge and keeps verifier in this browser', async () => {
    const destination = browser(); await beginSsoLogin();
    const url = new URL(destination());
    const pending = JSON.parse(sessionStorage.getItem('ainspace-sso-pending')!);
    assert.equal(url.pathname, '/api/auth/sso/external/start');
    assert.equal(url.searchParams.get('codeChallenge'), createHash('sha256').update(pending.verifier).digest('base64url'));
    assert.equal(url.searchParams.get('state'), pending.state);
    assert.equal(url.searchParams.get('redirectUri'), 'https://ainspace.example/login/sso');
    assert.ok(!destination().includes(pending.verifier));
});
test('SSO callback requires matching state before contacting the backend', async () => {
    browser(); await beginSsoLogin(); let requests = 0;
    globalThis.fetch = (async () => { requests++; throw Error('must not contact backend'); }) as typeof fetch;
    await assert.rejects(completeSsoLogin(new URLSearchParams({ code: 'code', state: 'wrong' })));
    assert.equal(requests, 0); assert.equal(getAccessToken(), null);
});
test('expired SSO transactions cannot establish sessions', async () => {
    browser(); await beginSsoLogin(); const pending = JSON.parse(sessionStorage.getItem('ainspace-sso-pending')!);
    pending.createdAt = Date.now() - 11 * 60 * 1000;
    sessionStorage.setItem('ainspace-sso-pending', JSON.stringify(pending));
    await assert.rejects(completeSsoLogin(new URLSearchParams({ code: 'code', state: pending.state })));
    assert.equal(getSsoFlag(), false);
});
test('successful SSO exchange stores the original user and prevents callback replay', async () => {
    browser(); await beginSsoLogin(); const pending = JSON.parse(sessionStorage.getItem('ainspace-sso-pending')!);
    globalThis.fetch = (async (_url, init) => {
        assert.equal(init?.credentials, 'include');
        assert.equal(JSON.parse(init?.body as string).verifier, pending.verifier);
        return new Response(JSON.stringify({ user: { id: 'original-user', displayName: 'User', ainAddress: null, avatarUrl: null }, tokens: { accessToken: 'access', expiresIn: 3600 } }), { status: 200 });
    }) as typeof fetch;
    const params = new URLSearchParams({ code: 'code', state: pending.state });
    assert.equal((await completeSsoLogin(params)).id, 'original-user');
    assert.equal(getAccessToken(), 'access'); assert.equal(getSsoFlag(), true);
    await assert.rejects(completeSsoLogin(params));
    clearSession(); assert.equal(getSsoFlag(), false);
});
