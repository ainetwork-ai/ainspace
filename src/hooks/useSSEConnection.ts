'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

export interface UseSSEConnectionOptions {
  url: string | null;
  maxReconnectAttempts?: number;
  onMessage?: (event: MessageEvent) => void;
  listeners?: Record<string, (event: MessageEvent) => void>;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onMaxRetriesReached?: () => void;
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
}: UseSSEConnectionOptions): UseSSEConnectionReturn {
  const eventSourceRef = useRef<EventSource | null>(null);
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
    reconnectAttemptsRef.current = 0;

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
  }, [cleanup, maxReconnectAttempts]);

  useEffect(() => {
    if (url) {
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
