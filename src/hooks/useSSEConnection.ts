'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { readEventStream } from '@/lib/read-event-stream';

export interface UseSSEConnectionOptions {
  url: string | null;
  maxReconnectAttempts?: number;
  onMessage?: (event: MessageEvent) => void;
  listeners?: Record<string, (event: MessageEvent) => void>;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onMaxRetriesReached?: () => void;
  /** Fetch transport allows credentials in headers instead of URL query strings. */
  fetcher?: (url: string, init: RequestInit) => Promise<Response>;
}

export interface UseSSEConnectionReturn {
  isConnected: boolean;
  reconnectAttempts: number;
  disconnect: () => void;
  reconnect: () => void;
}

export function useSSEConnection({
  url,
  maxReconnectAttempts = 5,
  onMessage,
  listeners,
  onConnected,
  onDisconnected,
  onMaxRetriesReached,
  fetcher,
}: UseSSEConnectionOptions): UseSSEConnectionReturn {
  const eventSourceRef = useRef<EventSource | null>(null);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const [isConnected, setIsConnected] = useState(false);

  // Store latest callbacks in refs to avoid reconnect loops
  const onMessageRef = useRef(onMessage);
  const listenersRef = useRef(listeners);
  const onConnectedRef = useRef(onConnected);
  const onDisconnectedRef = useRef(onDisconnected);
  const onMaxRetriesReachedRef = useRef(onMaxRetriesReached);

  onMessageRef.current = onMessage;
  listenersRef.current = listeners;
  onConnectedRef.current = onConnected;
  onDisconnectedRef.current = onDisconnected;
  onMaxRetriesReachedRef.current = onMaxRetriesReached;

  const cleanup = useCallback(() => {
    fetchAbortRef.current?.abort();
    fetchAbortRef.current = null;
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    setIsConnected(false);
  }, []);

  const connect = useCallback((targetUrl: string) => {
    cleanup();

    if (fetcher) {
      const controller = new AbortController();
      fetchAbortRef.current = controller;
      void (async () => {
        try {
          const response = await fetcher(targetUrl, {
            headers: { accept: 'text/event-stream' },
            cache: 'no-store', signal: controller.signal,
          });
          if (controller.signal.aborted) { await response.body?.cancel(); return; }
          if (!response.ok || !response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) {
            await response.body?.cancel();
            throw new Error('Event stream unavailable');
          }
          setIsConnected(true);
          reconnectAttemptsRef.current = 0;
          onConnectedRef.current?.();
          await readEventStream(response.body, (name, data) => {
            if (fetchAbortRef.current !== controller || controller.signal.aborted) return;
            const event = new MessageEvent(name, { data });
            if (name === 'message') onMessageRef.current?.(event);
            else listenersRef.current?.[name]?.(event);
          }, controller.signal);
        } catch {
          // Reconnection below handles network and authentication failures.
        }
        if (controller.signal.aborted || fetchAbortRef.current !== controller) return;
        cleanup();
        onDisconnectedRef.current?.();
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current += 1;
          const delay = Math.min(1000 * 2 ** reconnectAttemptsRef.current, 30000);
          reconnectTimeoutRef.current = setTimeout(() => connect(targetUrl), delay);
        } else onMaxRetriesReachedRef.current?.();
      })();
      return;
    }

    const es = new EventSource(targetUrl);
    eventSourceRef.current = es;

    es.onopen = () => {
      setIsConnected(true);
      reconnectAttemptsRef.current = 0;
      onConnectedRef.current?.();
    };

    if (onMessageRef.current) {
      es.onmessage = (event) => {
        onMessageRef.current?.(event);
      };
    }

    if (listenersRef.current) {
      for (const [name, handler] of Object.entries(listenersRef.current)) {
        es.addEventListener(name, handler);
      }
    }

    es.onerror = () => {
      cleanup();
      onDisconnectedRef.current?.();

      if (reconnectAttemptsRef.current < maxReconnectAttempts) {
        reconnectAttemptsRef.current += 1;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
        reconnectTimeoutRef.current = setTimeout(() => {
          connect(targetUrl);
        }, delay);
      } else {
        onMaxRetriesReachedRef.current?.();
      }
    };
  }, [cleanup, maxReconnectAttempts, fetcher]);

  useEffect(() => {
    if (url) {
      reconnectAttemptsRef.current = 0;
      connect(url);
    } else {
      cleanup();
    }
    return cleanup;
  }, [url, connect, cleanup]);

  const disconnect = useCallback(() => {
    cleanup();
  }, [cleanup]);

  const reconnect = useCallback(() => {
    if (url) {
      reconnectAttemptsRef.current = 0;
      connect(url);
    }
  }, [url, connect]);

  return {
    isConnected,
    reconnectAttempts: reconnectAttemptsRef.current,
    disconnect,
    reconnect,
  };
}
