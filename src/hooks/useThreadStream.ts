import { useCallback, useState, useRef } from 'react';
import { StreamEvent } from '@/lib/a2aOrchestration';
import { useSSEConnection } from './useSSEConnection';
import { getAccessToken } from '@/lib/backend/token-store';
import { recoverStreamAuth } from '@/lib/backend/recover-stream-auth';
import * as Sentry from '@sentry/nextjs';

interface UseThreadStreamOptions {
  threadId: string | null;
  onMessage?: (event: StreamEvent) => void;
  // EPIC19: called when the stream auth-recovery is exhausted (refresh + one
  // reconnect failed, or recovery was impossible). The consumer turns this into a
  // render-phase throw instead of the old "system message first" error bubble.
  onFatal?: (error: Error) => void;
  enabled?: boolean;
}

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'reconnecting';

// EPIC19: a 401 within this window of the last recovery means the refreshed token
// is still rejected -> fatal (no tight loop). A 401 long after (e.g. the next hourly
// expiry on an idle kiosk) is allowed to self-heal again.
const RECOVERY_COOLDOWN_MS = 60000;

function isAuthErrorEvent(event: StreamEvent): boolean {
  return event?.type === 'error' && (event as { data?: { status?: number } })?.data?.status === 401;
}

/**
 * React hook to connect to a thread's SSE stream
 * Automatically handles connection and cleanup
 */
export function useThreadStream({ threadId, onMessage, onFatal, enabled = true }: UseThreadStreamOptions) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [lastError, setLastError] = useState<string | null>(null);
  // EPIC19: bumping this rebuilds the URL string so useSSEConnection reconnects
  // with a freshly-refreshed ?token= (a same-string URL would replay the stale one).
  const [tokenEpoch, setTokenEpoch] = useState(0);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const onFatalRef = useRef(onFatal);
  onFatalRef.current = onFatal;
  // Timestamp of the last auth recovery — gates re-entry by cooldown (see above).
  const lastRecoveryAtRef = useRef(0);
  // Lets recoverOnce cancel a pending stale-token transport reconnect. Filled in
  // after useSSEConnection returns.
  const disconnectRef = useRef<() => void>(() => {});

  // EPIC14: EventSource can't send the Authorization header, so the access
  // token is passed via ?token= and the BFF forwards it as a Bearer to the
  // backend. No token (guest) -> no stream.
  const token = threadId && enabled ? getAccessToken() : null;
  const url = token
    ? `/api/thread-stream/${threadId}?token=${encodeURIComponent(token)}&e=${tokenEpoch}`
    : null;

  // EPIC19: refresh/re-bootstrap then reconnect with a fresh token. A repeat 401
  // within the cooldown (refreshed token still rejected) goes fatal instead of
  // looping. Cancels the pending stale-token transport reconnect first so it can't
  // race the epoch-driven fresh reconnect.
  const recoverOnce = useCallback(async () => {
    if (Date.now() - lastRecoveryAtRef.current < RECOVERY_COOLDOWN_MS) {
      onFatalRef.current?.(new Error('chat stream auth recovery failed'));
      return;
    }
    lastRecoveryAtRef.current = Date.now();
    disconnectRef.current(); // cancel es.onerror's scheduled stale-URL reconnect
    const ok = await recoverStreamAuth();
    if (ok) {
      setTokenEpoch((e) => e + 1); // URL changes -> useSSEConnection reconnects once
    } else {
      onFatalRef.current?.(new Error('chat stream auth recovery failed'));
    }
  }, []);

  const handleMessage = useCallback((event: MessageEvent) => {
    let data: StreamEvent;
    try {
      data = JSON.parse(event.data);
    } catch (error) {
      console.error('Failed to parse SSE message:', error, 'Raw data:', event.data);
      return;
    }
    // EPIC19: intercept auth failures before they reach the consumer's error
    // bubble — refresh + reconnect once instead of showing "Error: ..." first.
    if (isAuthErrorEvent(data)) {
      void recoverOnce();
      return;
    }
    setConnectionStatus('connected');
    setLastError(null);
    onMessageRef.current?.(data);
  }, [recoverOnce]);

  const handleConnected = useCallback(() => {
    setConnectionStatus('connected');
    setLastError(null);
  }, []);

  const handleDisconnected = useCallback(() => {
    setConnectionStatus('reconnecting');
    setLastError('Connection lost. Reconnecting...');

    Sentry.captureMessage('SSE connection error', {
      level: 'warning',
      tags: { component: 'useThreadStream', error_type: 'sse_connection_error' },
      extra: { threadId },
    });
  }, [threadId]);

  // EPIC19: transport reconnects exhausted -> throw via onFatal instead of pushing
  // a "Please refresh" system message. (Auth-specific failures are handled earlier
  // in handleMessage; this covers pure transport death.)
  const handleMaxRetries = useCallback(() => {
    setConnectionStatus('error');
    setLastError('Connection failed.');

    Sentry.captureMessage('SSE max reconnect attempts reached', {
      level: 'warning',
      tags: { component: 'useThreadStream' },
      extra: { threadId },
    });

    onFatalRef.current?.(new Error('chat stream connection failed'));
  }, [threadId]);

  const { isConnected, reconnectAttempts, disconnect, reconnect } = useSSEConnection({
    url,
    onMessage: handleMessage,
    onConnected: handleConnected,
    onDisconnected: handleDisconnected,
    onMaxRetriesReached: handleMaxRetries,
  });
  // Expose disconnect to recoverOnce (defined above useSSEConnection).
  disconnectRef.current = disconnect;

  return {
    reconnect,
    disconnect,
    isConnected,
    connectionStatus,
    lastError,
    reconnectAttempts,
  };
}
