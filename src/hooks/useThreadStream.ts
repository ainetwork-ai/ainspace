import { useEffect, useRef, useCallback } from 'react';
import { connectToThreadStream, StreamEvent } from '@/lib/a2aOrchestration';

interface UseThreadStreamOptions {
  threadId: string | null;
  onMessage?: (event: StreamEvent) => void;
  enabled?: boolean;
}

/**
 * React hook to connect to a thread's SSE stream
 * Automatically handles connection and cleanup
 */
export function useThreadStream({ threadId, onMessage, enabled = true }: UseThreadStreamOptions) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;

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

    try {
      const eventSource = connectToThreadStream(threadId, (event) => {
        // Reset reconnect attempts on successful message
        reconnectAttemptsRef.current = 0;

        // Call user's onMessage handler
        if (onMessage) {
          onMessage(event);
        }
      });

      // Handle connection errors
      eventSource.onerror = (error) => {
        console.error('SSE connection error for thread:', threadId, error);
        cleanup();

        // Attempt to reconnect with exponential backoff
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current += 1;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);

          console.log(
            `Reconnecting in ${delay}ms... (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})`
          );

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        } else {
          console.error('Max reconnect attempts reached');
          if (onMessage) {
            onMessage({
              type: 'error',
              data: { error: 'Max reconnect attempts reached' },
            });
          }
        }
      };

      eventSourceRef.current = eventSource;
    } catch (error) {
      console.error('Failed to connect to stream:', error);
      if (onMessage) {
        onMessage({
          type: 'error',
          data: { error: 'Failed to connect to stream' },
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
  };
}
