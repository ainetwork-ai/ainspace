import { NextRequest } from 'next/server';
import { villageHuddleInstance } from '@/lib/village-huddle-instance';
import { randomUUID } from 'node:crypto';
import { joinVillageConnection, renewVillageConnection, releaseVillageConnection, removeIdleVillagePresence } from '@/lib/village-connection-presence';
import {
  getRedisSubscriber,
  getVillagePlayers,
  cleanupStale,
  PlayerPresence,
} from '@/lib/redis';
import { DIRECTION } from '@/constants/game';
import { authorizeVillagePresence, VillagePresenceAuthError } from '@/lib/village-presence-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const village = searchParams.get('village');
  const claimedUserId = searchParams.get('userId');

  if (!village || !claimedUserId) {
    return new Response('village and userId are required', { status: 400 });
  }

  let userId: string;
  try { userId = await authorizeVillagePresence(request, claimedUserId); }
  catch (error) {
    return new Response('Presence session unavailable', {
      status: error instanceof VillagePresenceAuthError ? error.status : 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const sourceInstance = await villageHuddleInstance(village);
  if (!sourceInstance) return new Response('Village unavailable', { status: 404 });
  const instanceId = sourceInstance.instanceId;

  const prevVillage = searchParams.get('prevVillage') || null;

  // Parse initial player data from query
  const playerData = {
    x: Number(searchParams.get('x') || 0),
    y: Number(searchParams.get('y') || 0),
    direction: (searchParams.get('direction') as DIRECTION) || DIRECTION.DOWN,
    spriteKey: searchParams.get('spriteKey') || 'sprite_user.png',
    displayName: searchParams.get('displayName') || userId.slice(0, 8),
  };

  const connectionId = randomUUID();
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
        releaseVillageConnection(village, userId, connectionId, instanceId).catch(() => {});
        try {
          controller.close();
        } catch {
          // Already closed
        }
      };

      // Listen for client disconnect
      request.signal.addEventListener('abort', cleanup);

      let eventDelivery = Promise.resolve();
      listenerFn = (message: string) => {
        eventDelivery = eventDelivery.then(async () => {
        if (closed) return;
        try {
          if ((await villageHuddleInstance(village))?.instanceId !== instanceId) { cleanup(); return; }
          if (closed) return;
          const parsed = JSON.parse(message);
          // Filter out own events
          if (parsed.userId === userId) return;

          if (!snapshotSent) {
            eventBuffer.push(message);
          } else {
            send('presence', message);
          }
        } catch {
          // Invalid or unavailable source: close rather than forward another instance.
          cleanup();
        }
        });
      };

      try {
        // 1. Subscribe first (before snapshot) to avoid missing events
        const sub = await getRedisSubscriber();
        await sub.subscribe(`village:${village}:events`, listenerFn);

        // 2. Join village (saves presence + publishes PLAYER_JOINED) + set initial heartbeat
        if (closed) return;
        // A different tab may still occupy the previous village.
        if (prevVillage && prevVillage !== village) {
          await removeIdleVillagePresence(prevVillage, userId);
        }
        if (closed) return;
        await joinVillageConnection(village, userId, connectionId, instanceId, playerData);
        if (closed) {
          await releaseVillageConnection(village, userId, connectionId, instanceId);
          return;
        }

        // 3. Send initial snapshot
        let players: PlayerPresence[] = [];
        try {
          players = await getVillagePlayers(village);
        } catch {
          // Degraded mode — empty snapshot
        }
        if ((await villageHuddleInstance(village))?.instanceId !== instanceId) { cleanup(); return; }
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
            // A stream must stop after its account session is revoked.
            await authorizeVillagePresence(request, userId);
            if (closed) return;
            await renewVillageConnection(village, userId, connectionId, instanceId);
            if (closed) { await releaseVillageConnection(village, userId, connectionId, instanceId); return; }
          } catch {
            cleanup();
          }
        }, 15000);

        // 6. Stale cleanup every 5 minutes (auxiliary safety net)
        cleanupInterval = setInterval(async () => {
          if (closed) return;
          try {
            if ((await villageHuddleInstance(village))?.instanceId !== instanceId) { cleanup(); return; }
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
        if (!snapshotSent) {
          send('snapshot', JSON.stringify({ players: [] }));
          snapshotSent = true;
        }
        cleanup();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'private, no-store, no-transform',
      'Vary': 'Authorization',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
