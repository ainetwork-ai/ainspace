import { NextRequest } from 'next/server';
import {
  getRedisClient,
  getRedisSubscriber,
  joinVillage,
  getVillagePlayers,
  removePlayerPresence,
  cleanupStale,
  PlayerPresence,
} from '@/lib/redis';
import { DIRECTION } from '@/constants/game';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const village = searchParams.get('village');
  const userId = searchParams.get('userId');

  if (!village || !userId) {
    return new Response('village and userId are required', { status: 400 });
  }

  const prevVillage = searchParams.get('prevVillage') || null;

  // Parse initial player data from query
  const playerData = {
    x: Number(searchParams.get('x') || 0),
    y: Number(searchParams.get('y') || 0),
    direction: (searchParams.get('direction') as DIRECTION) || DIRECTION.DOWN,
    spriteKey: searchParams.get('spriteKey') || 'sprite_user.png',
    displayName: searchParams.get('displayName') || userId.slice(0, 8),
  };

  const encoder = new TextEncoder();
  const connectionStart = Date.now();
  // Random jitter 0-10s for thundering herd mitigation (kept small to stay within maxDuration)
  const jitterMs = Math.floor(Math.random() * 10000);

  const stream = new ReadableStream({
    async start(controller) {
      let pingInterval: ReturnType<typeof setInterval> | null = null;
      let cleanupInterval: ReturnType<typeof setInterval> | null = null;
      let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
      let closed = false;

      // Buffer for events arriving between subscribe and snapshot
      const eventBuffer: string[] = [];
      let snapshotSent = false;

      // eslint-disable-next-line prefer-const
      let listenerFn: ((message: string) => void) | null = null;

      const send = (event: string, data: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
        } catch {
          // Stream already closed
        }
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (pingInterval) clearInterval(pingInterval);
        if (cleanupInterval) clearInterval(cleanupInterval);
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        if (listenerFn) {
          getRedisSubscriber()
            .then(sub => sub.unsubscribe(`village:${village}:events`, listenerFn!))
            .catch(() => {});
        }
        // Explicitly remove presence + heartbeat on disconnect
        removePlayerPresence(village, userId).catch(() => {});
        getRedisClient()
          .then(redis => redis.hDel(`village:${village}:heartbeat`, userId))
          .catch(() => {});
        try {
          controller.close();
        } catch {
          // Already closed
        }
      };

      // Listen for client disconnect
      request.signal.addEventListener('abort', cleanup);

      listenerFn = (message: string) => {
        if (closed) return;
        try {
          const parsed = JSON.parse(message);
          // Filter out own events
          if (parsed.userId === userId) return;

          if (!snapshotSent) {
            eventBuffer.push(message);
          } else {
            send('presence', message);
          }
        } catch {
          // Invalid message, skip
        }
      };

      try {
        // 1. Subscribe first (before snapshot) to avoid missing events
        const sub = await getRedisSubscriber();
        await sub.subscribe(`village:${village}:events`, listenerFn);

        // 2. Join village (saves presence + publishes PLAYER_JOINED) + set initial heartbeat
        await joinVillage(userId, village, playerData, prevVillage);
        const redis = await getRedisClient();
        await redis.hSet(`village:${village}:heartbeat`, userId, String(Date.now()));
        await redis.expire(`village:${village}:heartbeat`, 3600);

        // 3. Send initial snapshot
        let players: PlayerPresence[] = [];
        try {
          players = await getVillagePlayers(village);
        } catch {
          // Degraded mode — empty snapshot
        }
        // Exclude self from snapshot
        const otherPlayers = players.filter(p => p.userId !== userId);
        send('snapshot', JSON.stringify({ players: otherPlayers }));
        snapshotSent = true;

        // 4. Flush buffered events
        for (const msg of eventBuffer) {
          send('presence', msg);
        }
        eventBuffer.length = 0;

        // 5. Heartbeat ping every 15s — write to separate heartbeat hash (1 call, no race)
        pingInterval = setInterval(async () => {
          if (closed) return;
          send('ping', '{}');
          try {
            const redis = await getRedisClient();
            await redis.hSet(`village:${village}:heartbeat`, userId, String(Date.now()));
            await redis.expire(`village:${village}:heartbeat`, 3600);
          } catch {
            // Non-critical
          }
        }, 15000);

        // 6. Stale cleanup every 5 minutes (auxiliary safety net)
        cleanupInterval = setInterval(async () => {
          if (closed) return;
          try {
            await cleanupStale(village);
          } catch {
            // Non-critical
          }
        }, 300000);

        // 7. Graceful reconnect before function duration expires
        // maxDuration=300s, send reconnect ~10s before, plus jitter (0-10s)
        // Worst case: 300 - 10 + 10 = 300s = exactly at limit, so cap at 280s
        const reconnectDelay = Math.min(
          (maxDuration * 1000) - 10000 + jitterMs - (Date.now() - connectionStart),
          280000
        );
        reconnectTimeout = setTimeout(() => {
          if (closed) return;
          send('reconnect', '{}');
          // Give client 2s to receive the message before closing
          setTimeout(cleanup, 2000);
        }, Math.max(reconnectDelay, 60000));
      } catch (error) {
        console.error('Village SSE setup error:', error);
        // Send empty snapshot in degraded mode
        if (!snapshotSent) {
          send('snapshot', JSON.stringify({ players: [] }));
          snapshotSent = true;
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
