import { useEffect, useRef, useCallback, useState } from 'react';
import { connectToThreadStream, StreamEvent } from '@/lib/a2aOrchestration';
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
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [lastError, setLastError] = useState<string | null>(null);

  // Cleanup function
  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  // Connect to stream
  const connect = useCallback(() => {
    if (!threadId || !enabled) return;

    cleanup();
    setConnectionStatus('connecting');
    setLastError(null);

    try {
      const eventSource = connectToThreadStream(threadId, (event) => {
        // Reset reconnect attempts on successful message
        reconnectAttemptsRef.current = 0;
        setConnectionStatus('connected');
        setLastError(null);

        // Call user's onMessage handler
        if (onMessage) {
          onMessage(event);
        }
      });

      // Handle connection errors
      eventSource.onerror = (error) => {
        const errorMsg = `SSE connection error for thread: ${threadId}`;
        console.error(errorMsg, error);

        // Log to Sentry but don't throw - keep app running
        Sentry.captureMessage(errorMsg, {
          level: 'warning',
          tags: {
            component: 'useThreadStream',
            error_type: 'sse_connection_error',
          },
          extra: {
            threadId,
            reconnectAttempt: reconnectAttemptsRef.current,
            maxAttempts: maxReconnectAttempts,
            readyState: eventSource.readyState,
          },
        });

        cleanup();

        // Attempt to reconnect with exponential backoff
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current += 1;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);

          setConnectionStatus('reconnecting');
          setLastError(`Connection lost. Reconnecting... (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})`);

          console.log(
            `Reconnecting in ${delay}ms... (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})`
          );

          Sentry.addBreadcrumb({
            category: 'sse',
            message: 'Attempting SSE reconnection',
            level: 'info',
            data: {
              threadId,
              attempt: reconnectAttemptsRef.current,
              delay,
            },
          });

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        } else {
          const maxAttemptsMsg = 'Connection failed. Please refresh the page.';
          console.error('Max reconnect attempts reached');

          setConnectionStatus('error');
          setLastError(maxAttemptsMsg);

          // Log max reconnect attempts reached to Sentry
          Sentry.captureMessage('SSE max reconnect attempts reached', {
            level: 'warning',
            tags: {
              component: 'useThreadStream',
            },
            extra: {
              threadId,
              maxAttempts: maxReconnectAttempts,
            },
          });

          if (onMessage) {
            onMessage({
              type: 'error',
              data: { error: maxAttemptsMsg },
            });
          }
        }
      };

      eventSourceRef.current = eventSource;
    } catch (error) {
      const failMsg = 'Failed to connect to stream';
      console.error(failMsg, error);

      setConnectionStatus('error');
      setLastError(failMsg);

      // Log connection failure to Sentry but don't crash app
      Sentry.captureMessage(failMsg, {
        level: 'warning',
        tags: {
          component: 'useThreadStream',
          error_type: 'connection_failure',
        },
        extra: {
          threadId,
          errorType: error instanceof Error ? error.name : typeof error,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });

      if (onMessage) {
        onMessage({
          type: 'error',
          data: { error: failMsg },
        });
      }
    }
  }, [threadId, enabled, onMessage, cleanup]);

  // Connect when threadId changes or enabled changes
  useEffect(() => {
    if (threadId && enabled) {
      connect();
    } else {
      cleanup();
    }

    return cleanup;
  }, [threadId, enabled, connect, cleanup]);

  // Manual reconnect function
  const reconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    connect();
  }, [connect]);

  // Manual disconnect function
  const disconnect = useCallback(() => {
    cleanup();
  }, [cleanup]);

  return {
    reconnect,
    disconnect,
    isConnected: eventSourceRef.current !== null && eventSourceRef.current.readyState === EventSource.OPEN,
    connectionStatus,
    lastError,
    reconnectAttempts: reconnectAttemptsRef.current,
  };
}
