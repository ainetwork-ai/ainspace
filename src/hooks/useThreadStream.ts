import { useCallback, useState, useRef } from 'react';
import { StreamEvent } from '@/lib/a2aOrchestration';
import { useSSEConnection } from './useSSEConnection';
import * as Sentry from '@sentry/nextjs';

interface UseThreadStreamOptions {
  threadId: string | null;
  onMessage?: (event: StreamEvent) => void;
  enabled?: boolean;
}

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'reconnecting';

/**
 * React hook to connect to a thread's SSE stream
 * Automatically handles connection and cleanup
 */
export function useThreadStream({ threadId, onMessage, enabled = true }: UseThreadStreamOptions) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [lastError, setLastError] = useState<string | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const url = threadId && enabled ? `/api/thread-stream/${threadId}` : null;

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      setConnectionStatus('connected');
      setLastError(null);
      onMessageRef.current?.(data);
    } catch (error) {
      console.error('Failed to parse SSE message:', error, 'Raw data:', event.data);
    }
  }, []);

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

  const handleMaxRetries = useCallback(() => {
    const maxAttemptsMsg = 'Connection failed. Please refresh the page.';
    setConnectionStatus('error');
    setLastError(maxAttemptsMsg);

    Sentry.captureMessage('SSE max reconnect attempts reached', {
      level: 'warning',
      tags: { component: 'useThreadStream' },
      extra: { threadId },
    });

    onMessageRef.current?.({
      type: 'error',
      data: { error: maxAttemptsMsg },
    });
  }, [threadId]);

  const { isConnected, reconnectAttempts, disconnect, reconnect } = useSSEConnection({
    url,
    onMessage: handleMessage,
    onConnected: handleConnected,
    onDisconnected: handleDisconnected,
    onMaxRetriesReached: handleMaxRetries,
  });

  return {
    reconnect,
    disconnect,
    isConnected,
    connectionStatus,
    lastError,
    reconnectAttempts,
  };
}
