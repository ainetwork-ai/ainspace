'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { DIRECTION } from '@/constants/game';
import { useUserStore, useGameStateStore } from '@/stores';
import { useVillageStore } from '@/stores/useVillageStore';
import { getDisplayName } from '@/lib/utils';
import { useSSEConnection } from './useSSEConnection';

export interface OnlinePlayer {
  userId: string;
  x: number;
  y: number;
  direction: DIRECTION;
  spriteKey: string;
  displayName: string;
  isLeaving: boolean;
}

export function useVillagePresence(): { players: OnlinePlayer[] } {
  const [players, setPlayers] = useState<OnlinePlayer[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leavingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const prevVillageRef = useRef<string | null>(null);
  const [sseUrl, setSseUrl] = useState<string | null>(null);

  const userId = useUserStore((s) => s.getUserId());
  const villageSlug = useVillageStore((s) => s.currentVillageSlug);

  // Domain cleanup (leaving timers, debounce) — separate from SSE cleanup
  const cleanupDomain = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    for (const timer of leavingTimersRef.current.values()) {
      clearTimeout(timer);
    }
    leavingTimersRef.current.clear();
  }, []);

  const handleSnapshot = useCallback((e: MessageEvent) => {
    try {
      const { players: serverPlayers } = JSON.parse(e.data);
      const uid = useUserStore.getState().getUserId();
      const mapped: OnlinePlayer[] = (serverPlayers || [])
        .filter((p: { userId: string }) => p.userId !== uid)
        .map((p: { userId: string; x: number; y: number; direction: string; spriteKey: string; displayName: string }) => ({
          userId: p.userId,
          x: p.x,
          y: p.y,
          direction: p.direction as DIRECTION,
          spriteKey: p.spriteKey || 'sprite_user.png',
          displayName: p.displayName || p.userId.slice(0, 8),
          isLeaving: false,
        }));
      setPlayers(mapped);
    } catch {
      console.error('Failed to parse snapshot');
    }
  }, []);

  const handlePresence = useCallback((e: MessageEvent) => {
    try {
      const event = JSON.parse(e.data);
      const uid = useUserStore.getState().getUserId();
      if (event.userId === uid) return;

      switch (event.type) {
        case 'PLAYER_JOINED':
          setPlayers((prev) => {
            const existing = prev.find((p) => p.userId === event.userId);
            if (existing) {
              return prev.map((p) =>
                p.userId === event.userId
                  ? {
                      ...p,
                      x: event.x,
                      y: event.y,
                      direction: event.direction as DIRECTION,
                      spriteKey: event.spriteKey || p.spriteKey,
                      displayName: event.displayName || p.displayName,
                      isLeaving: false,
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
                direction: event.direction as DIRECTION,
                spriteKey: event.spriteKey || 'sprite_user.png',
                displayName: event.displayName || event.userId.slice(0, 8),
                isLeaving: false,
              },
            ];
          });
          break;

        case 'PLAYER_LEFT': {
          setPlayers((prev) =>
            prev.map((p) =>
              p.userId === event.userId ? { ...p, isLeaving: true } : p
            )
          );
          const prevTimer = leavingTimersRef.current.get(event.userId);
          if (prevTimer) clearTimeout(prevTimer);

          const timer = setTimeout(() => {
            setPlayers((prev) => {
              const player = prev.find((p) => p.userId === event.userId);
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
            if (!exists) return prev;
            const newDir = event.direction as DIRECTION;
            if (exists.x === event.x && exists.y === event.y && exists.direction === newDir) return prev;
            return prev.map((p) =>
              p.userId === event.userId
                ? { ...p, x: event.x, y: event.y, direction: newDir }
                : p
            );
          });
          break;
      }
    } catch {
      console.error('Failed to parse presence event');
    }
  }, []);

  const handleReconnect = useCallback(() => {
    // Server function expiring — trigger reconnect by rebuilding URL
    if (villageSlug && userId) {
      setSseUrl(null);
      // Briefly set null then rebuild to trigger useSSEConnection reconnect
      setTimeout(() => {
        const { worldPosition, playerDirection } = useGameStateStore.getState();
        const { address, sessionId } = useUserStore.getState();
        const displayName = getDisplayName(address, sessionId, userId);
        const params = new URLSearchParams({
          village: villageSlug,
          userId,
          x: String(worldPosition.x),
          y: String(worldPosition.y),
          direction: playerDirection,
          spriteKey: 'sprite_user.png',
          displayName,
        });
        setSseUrl(`/api/village-sse?${params.toString()}`);
      }, 0);
    }
  }, [villageSlug, userId]);

  const handleError = useCallback((e: MessageEvent) => {
    console.warn('Village SSE error event from server', e.data);
  }, []);

  const listeners = useMemo(() => ({
    snapshot: handleSnapshot,
    presence: handlePresence,
    reconnect: handleReconnect,
    error: handleError,
  }), [handleSnapshot, handlePresence, handleReconnect, handleError]);

  const handleMaxRetries = useCallback(() => {
    console.warn('Village SSE: max reconnect attempts reached');
    setPlayers([]);
  }, []);

  useSSEConnection({
    url: sseUrl,
    listeners,
    onMaxRetriesReached: handleMaxRetries,
  });

  // Build SSE URL when village/user changes, with 500ms debounce
  useEffect(() => {
    if (!villageSlug || !userId) {
      cleanupDomain();
      setSseUrl(null);
      setPlayers([]);
      return;
    }

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    const prev = prevVillageRef.current;
    debounceRef.current = setTimeout(() => {
      const { worldPosition, playerDirection } = useGameStateStore.getState();
      const { address, sessionId } = useUserStore.getState();
      const displayName = getDisplayName(address, sessionId, userId);

      const params = new URLSearchParams({
        village: villageSlug,
        userId,
        x: String(worldPosition.x),
        y: String(worldPosition.y),
        direction: playerDirection,
        spriteKey: 'sprite_user.png',
        displayName,
      });
      if (prev && prev !== villageSlug) {
        params.set('prevVillage', prev);
      }
      setSseUrl(`/api/village-sse?${params.toString()}`);
      prevVillageRef.current = villageSlug;
    }, 500);

    return () => {
      cleanupDomain();
      setSseUrl(null);
      setPlayers([]);
    };
  }, [villageSlug, userId, cleanupDomain]);

  return { players };
}
