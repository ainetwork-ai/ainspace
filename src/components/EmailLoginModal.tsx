'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { Mail } from 'lucide-react';
import {
    EmailAuthError,
    loginWithEmail,
    registerWithEmail,
    requestEmailCode,
    verifyEmailCode,
} from '@/lib/backend/auth';
import { BackendUser } from '@/types/backend';

interface EmailLoginModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: (user: BackendUser) => void;
    isDarkMode?: boolean;
}

// login: 1-step. signup is 3 steps: email -> code -> password.
type Mode = 'login' | 'signup-email' | 'signup-code' | 'signup-password';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;
const CODE_LEN = 6;

export default function EmailLoginModal({
    open,
    onOpenChange,
    onSuccess,
    isDarkMode = false,
}: EmailLoginModalProps) {
    const [mode, setMode] = useState<Mode>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [code, setCode] = useState('');
    const [displayName, setDisplayName] = useState('');

    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);
    // 429 cooldown: seconds remaining before the action can be retried.
    const [cooldown, setCooldown] = useState(0);

    // Reset transient state whenever the modal opens or fully closes.
    useEffect(() => {
        if (!open) return;
        setMode('login');
        setEmail('');
        setPassword('');
        setCode('');
        setDisplayName('');
        setError(null);
        setRemainingAttempts(null);
        setCooldown(0);
    }, [open]);

    // Tick down the 429 cooldown once per second.
    useEffect(() => {
        if (cooldown <= 0) return;
        const id = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
        return () => clearInterval(id);
    }, [cooldown]);

    const switchMode = useCallback((next: Mode) => {
        setMode(next);
        setError(null);
        setRemainingAttempts(null);
        setCooldown(0);
    }, []);

    const handleError = useCallback((e: unknown) => {
        if (e instanceof EmailAuthError) {
            setError(e.message);
            if (typeof e.remainingAttempts === 'number') setRemainingAttempts(e.remainingAttempts);
            if (e.retryAfterSeconds && e.retryAfterSeconds > 0) setCooldown(e.retryAfterSeconds);
        } else {
            setError('Something went wrong. Please try again.');
        }
    }, []);

    // Wrap an async action with submitting + error handling.
    const run = useCallback(
        async (action: () => Promise<void>) => {
            setSubmitting(true);
            setError(null);
            try {
                await action();
            } catch (e) {
                handleError(e);
            } finally {
                setSubmitting(false);
            }
        },
        [handleError]
    );

    const doLogin = () =>
        run(async () => {
            const user = await loginWithEmail({ email, password });
            onSuccess(user);
        });

    const doRequestCode = () =>
        run(async () => {
            await requestEmailCode(email);
            switchMode('signup-code');
        });

    const doVerifyCode = () =>
        run(async () => {
            await verifyEmailCode(email, code);
            switchMode('signup-password');
        });

    const doRegister = () =>
        run(async () => {
            const user = await registerWithEmail({ email, password, displayName });
            onSuccess(user);
        });

    const doResendCode = () =>
        run(async () => {
            await requestEmailCode(email);
        });

    const emailValid = EMAIL_RE.test(email);
    const passwordValid = password.length >= MIN_PASSWORD;
    const codeValid = code.trim().length === CODE_LEN;
    const blocked = submitting || cooldown > 0;

    // --- styling helpers (mirror ConnectWalletModal tones) ---
    const inputCls = `w-full py-2.5 px-3 rounded-lg text-sm outline-none border transition-colors ${
        isDarkMode
            ? 'bg-[#2A2E36] border-[#3A3E46] text-white placeholder:text-[#838D9D] focus:border-[#7C3AED]'
            : 'bg-white border-[#E5E7EB] text-black placeholder:text-[#969EAA] focus:border-[#7C3AED]'
    }`;
    const primaryBtnCls =
        'w-full py-3 px-4 font-bold rounded-lg transition-colors flex items-center justify-center gap-2 bg-[#7C3AED] text-white hover:bg-[#6D28D9] disabled:opacity-50 disabled:cursor-not-allowed';
    const linkBtnCls = `text-sm font-medium transition-colors disabled:opacity-50 ${
        isDarkMode ? 'text-[#C0A9F1] hover:text-white' : 'text-[#7C3AED] hover:text-[#6D28D9]'
    }`;

    const cooldownLabel = cooldown > 0 ? ` (${cooldown}s)` : '';

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className={`w-[320px] rounded-2xl py-6 px-4 shadow-lg flex flex-col gap-4 border-none ${
                    isDarkMode ? 'dark bg-[#2F333B] [&_[data-slot=dialog-close]]:text-white' : 'bg-white'
                }`}
            >
                <DialogHeader className="flex flex-col items-center gap-1 pt-2">
                    <div
                        className={`w-16 h-16 rounded-full flex items-center justify-center mb-2 ${
                            isDarkMode ? 'bg-[#3A3050]' : 'bg-[#f7f0ff]'
                        }`}
                    >
                        <Mail className={`w-8 h-8 ${isDarkMode ? 'text-[#C0A9F1]' : 'text-[#7C3AED]'}`} />
                    </div>
                    <DialogTitle
                        className={`text-xl font-bold text-center ${isDarkMode ? 'text-white' : 'text-black'}`}
                    >
                        {mode === 'login' ? 'Log in' : 'Sign up'}
                    </DialogTitle>
                    <DialogDescription
                        className={`text-base text-center ${isDarkMode ? 'text-[#CAD0D7]' : 'text-[#2F333B]'}`}
                    >
                        {mode === 'login' && 'Log in with your email.'}
                        {mode === 'signup-email' && "We'll send a verification code to your email."}
                        {mode === 'signup-code' && `Enter the ${CODE_LEN}-digit code we sent.`}
                        {mode === 'signup-password' && 'Set a password to finish signing up.'}
                    </DialogDescription>
                </DialogHeader>

                <form
                    className="flex flex-col gap-3"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (blocked) return;
                        if (mode === 'login') doLogin();
                        else if (mode === 'signup-email') doRequestCode();
                        else if (mode === 'signup-code') doVerifyCode();
                        else doRegister();
                    }}
                >
                    {/* LOGIN */}
                    {mode === 'login' && (
                        <>
                            <input
                                type="email"
                                autoComplete="email"
                                placeholder="Email"
                                className={inputCls}
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                            />
                            <input
                                type="password"
                                autoComplete="current-password"
                                placeholder="Password"
                                className={inputCls}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                            <button type="submit" className={primaryBtnCls} disabled={blocked || !emailValid || !password}>
                                {submitting && <Spinner />}
                                {`Log in${cooldownLabel}`}
                            </button>
                        </>
                    )}

                    {/* SIGNUP STEP 1: email */}
                    {mode === 'signup-email' && (
                        <>
                            <input
                                type="email"
                                autoComplete="email"
                                placeholder="Email"
                                className={inputCls}
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                            />
                            <button type="submit" className={primaryBtnCls} disabled={blocked || !emailValid}>
                                {submitting && <Spinner />}
                                {`Send code${cooldownLabel}`}
                            </button>
                        </>
                    )}

                    {/* SIGNUP STEP 2: code */}
                    {mode === 'signup-code' && (
                        <>
                            <input
                                type="text"
                                inputMode="numeric"
                                maxLength={CODE_LEN}
                                placeholder={`${CODE_LEN}-digit code`}
                                className={`${inputCls} tracking-[0.4em] text-center`}
                                value={code}
                                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                            />
                            <button type="submit" className={primaryBtnCls} disabled={blocked || !codeValid}>
                                {submitting && <Spinner />}
                                Verify
                            </button>
                            <button
                                type="button"
                                className={`${linkBtnCls} self-center`}
                                disabled={blocked}
                                onClick={doResendCode}
                            >
                                {`Resend code${cooldownLabel}`}
                            </button>
                        </>
                    )}

                    {/* SIGNUP STEP 3: password + displayName */}
                    {mode === 'signup-password' && (
                        <>
                            <input
                                type="text"
                                autoComplete="nickname"
                                placeholder="Display name"
                                className={inputCls}
                                value={displayName}
                                onChange={(e) => setDisplayName(e.target.value)}
                            />
                            <input
                                type="password"
                                autoComplete="new-password"
                                placeholder={`Password (${MIN_PASSWORD}+ characters)`}
                                className={inputCls}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                            <button
                                type="submit"
                                className={primaryBtnCls}
                                disabled={blocked || !passwordValid || !displayName.trim()}
                            >
                                {submitting && <Spinner />}
                                Create account
                            </button>
                        </>
                    )}
                </form>

                {error && (
                    <p className="text-sm text-center text-[#E5484D]">
                        {error}
                        {remainingAttempts !== null && ` (${remainingAttempts} attempts left)`}
                    </p>
                )}

                {/* mode toggle */}
                <button
                    type="button"
                    className={`${linkBtnCls} self-center`}
                    onClick={() => switchMode(mode === 'login' ? 'signup-email' : 'login')}
                >
                    {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Log in'}
                </button>
            </DialogContent>
        </Dialog>
    );
}
