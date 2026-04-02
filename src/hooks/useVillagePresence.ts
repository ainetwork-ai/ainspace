'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { DIRECTION } from '@/constants/game';
import { useUserStore, useGameStateStore } from '@/stores';
import { useVillageStore } from '@/stores/useVillageStore';
import { shortAddress } from '@/lib/utils';

export interface OnlinePlayer {
  userId: string;
  x: number;
  y: number;
  direction: DIRECTION;
  spriteKey: string;
  displayName: string;
  isLeaving: boolean;
  isNew: boolean; // true for PLAYER_JOINED (fade-in), false for snapshot
}

const DIRECTION_MAP: Record<string, DIRECTION> = {
  up: DIRECTION.UP,
  down: DIRECTION.DOWN,
  left: DIRECTION.LEFT,
  right: DIRECTION.RIGHT,
};

function toDirection(s: string): DIRECTION {
  return DIRECTION_MAP[s] || DIRECTION.DOWN;
}

export function useVillagePresence(): { players: OnlinePlayer[] } {
  const [players, setPlayers] = useState<OnlinePlayer[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leavingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const prevVillageRef = useRef<string | null>(null);
  const maxReconnectAttempts = 5;

  const userId = useUserStore((s) => s.getUserId());
  const villageSlug = useVillageStore((s) => s.currentVillageSlug);

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    // Clear all leaving timers
    for (const timer of leavingTimersRef.current.values()) {
      clearTimeout(timer);
    }
    leavingTimersRef.current.clear();
  }, []);

  const connect = useCallback((slug: string, uid: string, prevSlug?: string | null) => {
    cleanup();
    reconnectAttemptsRef.current = 0;

    const { worldPosition, playerDirection } = useGameStateStore.getState();
    const { address, sessionId } = useUserStore.getState();
    const displayName = address ? shortAddress(address) : sessionId?.slice(0, 8) || uid.slice(0, 8);

    const params = new URLSearchParams({
      village: slug,
      userId: uid,
      x: String(worldPosition.x),
      y: String(worldPosition.y),
      direction: playerDirection,
      spriteKey: 'sprite_user.png',
      displayName,
    });
    if (prevSlug && prevSlug !== slug) {
      params.set('prevVillage', prevSlug);
    }

    const es = new EventSource(`/api/village-sse?${params.toString()}`);
    eventSourceRef.current = es;

    es.addEventListener('snapshot', (e) => {
      try {
        const { players: serverPlayers } = JSON.parse(e.data);
        const mapped: OnlinePlayer[] = (serverPlayers || [])
          .filter((p: { userId: string }) => p.userId !== uid)
          .map((p: { userId: string; x: number; y: number; direction: string; spriteKey: string; displayName: string }) => ({
            userId: p.userId,
            x: p.x,
            y: p.y,
            direction: toDirection(p.direction),
            spriteKey: p.spriteKey || 'sprite_user.png',
            displayName: p.displayName || p.userId.slice(0, 8),
            isLeaving: false,
            isNew: false,
          }));
        setPlayers(mapped);
        reconnectAttemptsRef.current = 0;
      } catch {
        console.error('Failed to parse snapshot');
      }
    });

    es.addEventListener('presence', (e) => {
      try {
        const event = JSON.parse(e.data);
        // Double-check: skip own events
        if (event.userId === uid) return;

        switch (event.type) {
          case 'PLAYER_JOINED':
            setPlayers((prev) => {
              const existing = prev.find((p) => p.userId === event.userId);
              if (existing) {
                // Update existing + reset isLeaving
                return prev.map((p) =>
                  p.userId === event.userId
                    ? {
                        ...p,
                        x: event.x,
                        y: event.y,
                        direction: toDirection(event.direction),
                        spriteKey: event.spriteKey || p.spriteKey,
                        displayName: event.displayName || p.displayName,
                        isLeaving: false,
                        isNew: false,
                      }
                    : p
                );
              }
              return [
                ...prev,
                {
                  userId: event.userId,
                  x: event.x,
                  y: event.y,
                  direction: toDirection(event.direction),
                  spriteKey: event.spriteKey || 'sprite_user.png',
                  displayName: event.displayName || event.userId.slice(0, 8),
                  isLeaving: false,
                  isNew: true,
                },
              ];
            });
            break;

          case 'PLAYER_LEFT': {
            // Mark as leaving, remove after 1.5s
            setPlayers((prev) =>
              prev.map((p) =>
                p.userId === event.userId ? { ...p, isLeaving: true } : p
              )
            );
            // Clear previous timer if any
            const prevTimer = leavingTimersRef.current.get(event.userId);
            if (prevTimer) clearTimeout(prevTimer);

            const timer = setTimeout(() => {
              setPlayers((prev) => {
                const player = prev.find((p) => p.userId === event.userId);
                // If player re-joined (isLeaving reset to false), don't remove
                if (player && !player.isLeaving) return prev;
                return prev.filter((p) => p.userId !== event.userId);
              });
              leavingTimersRef.current.delete(event.userId);
            }, 1500);
            leavingTimersRef.current.set(event.userId, timer);
            break;
          }

          case 'PLAYER_MOVED':
            setPlayers((prev) => {
              const exists = prev.find((p) => p.userId === event.userId);
              if (!exists) return prev; // Ignore if not in list
              return prev.map((p) =>
                p.userId === event.userId
                  ? {
                      ...p,
                      x: event.x,
                      y: event.y,
                      direction: toDirection(event.direction),
                    }
                  : p
              );
            });
            break;
        }
      } catch {
        console.error('Failed to parse presence event');
      }
    });

    es.addEventListener('reconnect', () => {
      // Server function expiring — reconnect immediately
      cleanup();
      connect(slug, uid);
    });

    es.addEventListener('error', () => {
      console.warn('Village SSE error event from server');
    });

    es.onerror = () => {
      cleanup();
      if (reconnectAttemptsRef.current < maxReconnectAttempts) {
        reconnectAttemptsRef.current += 1;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
        reconnectTimeoutRef.current = setTimeout(() => {
          connect(slug, uid);
        }, delay);
      } else {
        console.warn('Village SSE: max reconnect attempts reached');
        setPlayers([]);
      }
    };
  }, [cleanup]);

  useEffect(() => {
    if (!villageSlug || !userId) {
      cleanup();
      setPlayers([]);
      return;
    }

    // Debounce 500ms for rapid village boundary crossing
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    const prev = prevVillageRef.current;
    debounceRef.current = setTimeout(() => {
      connect(villageSlug, userId, prev);
      prevVillageRef.current = villageSlug;
    }, 500);

    return () => {
      cleanup();
      setPlayers([]);
    };
  }, [villageSlug, userId, connect, cleanup]);

  return { players };
}
