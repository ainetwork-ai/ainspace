'use client';

import React from 'react';

interface Props {
    children: React.ReactNode;
    // When this value changes, the boundary auto-resets (e.g. switching threads).
    resetKey?: string | number | null;
}

interface State {
    hasError: boolean;
}

/**
 * EPIC19: contains a ChatBox render throw (exhausted SSE auth recovery) to the
 * chat panel instead of letting it bubble to app/error.tsx and blank the whole
 * game canvas — important for the unattended kiosk. Shows a small inline fallback
 * with a retry; auto-resets when `resetKey` changes.
 */
export class ChatStreamErrorBoundary extends React.Component<Props, State> {
    state: State = { hasError: false };

    static getDerivedStateFromError(): State {
        return { hasError: true };
    }

    componentDidUpdate(prev: Props) {
        if (prev.resetKey !== this.props.resetKey && this.state.hasError) {
            this.setState({ hasError: false });
        }
    }

    private handleRetry = () => this.setState({ hasError: false });

    render() {
        if (this.state.hasError) {
            return (
                <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-4 text-center">
                    <p className="text-sm text-white/70">채팅 연결에 문제가 발생했습니다.</p>
                    <button
                        onClick={this.handleRetry}
                        className="cursor-pointer rounded-lg bg-[#7F4FE8] px-4 py-2 text-sm font-bold text-white"
                    >
                        다시 시도
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}
