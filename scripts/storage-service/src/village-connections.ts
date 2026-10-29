import { randomUUID } from 'node:crypto';
import { AinStateStore } from './ain-state-store';
import { ConnectionPresence, PresencePlayer } from './connection-presence';
export interface VillageConnectionCommand {
  operation: string; village?: string; instanceId?: string; userId?: string; connectionId?: string; player?: PresencePlayer;
}
type Event = Record<string, unknown>;
/** Called only behind the private gateway token. Account/session authorization belongs
 * to the frontend server; durable village existence/instance is rechecked here. */
export class VillageConnections {
  readonly leases: ConnectionPresence;
  constructor(private readonly store: AinStateStore, private readonly publish: (village: string, event: Event) => void, clock: () => number = Date.now) {
    this.leases = new ConnectionPresence(clock);
  }
  private village(value: unknown): string {
    if (typeof value !== 'string' || !value || value.length > 512 || /[\/:\0]/.test(value)) throw Error('Invalid village');
    return value;
  }
  private identity(value: unknown): string {
    if (typeof value !== 'string' || !value || value.length > 512 || value.includes('\0')) throw Error('Invalid presence identity');
    return value;
  }
  private player(value: PresencePlayer | undefined): PresencePlayer {
    if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y) || Math.abs(value.x) > 1e7 || Math.abs(value.y) > 1e7
      || !['up', 'down', 'left', 'right', 'stop'].includes(value.direction)
      || typeof value.displayName !== 'string' || value.displayName.length > 500
      || typeof value.spriteKey !== 'string' || !value.spriteKey || value.spriteKey.length > 512) throw Error('Invalid presence player');
    return { x: value.x, y: value.y, direction: value.direction, displayName: value.displayName, spriteKey: value.spriteKey };
  }
  async execute(command: VillageConnectionCommand): Promise<unknown> {
    const village = this.village(command.village), key = 'ainspace:village:' + village;
    const metadata = await this.store.hGetAll(key);
    if (metadata.slug !== village || !metadata.name || metadata.name.length > 500) {
      if (command.operation === 'village.instance') return null;
      throw Error('Village unavailable');
    }
    if (command.operation === 'village.instance') {
      const expected = { slug: village, name: metadata.name, ...(metadata.createdAt ? { createdAt: metadata.createdAt } : {}) };
      const instanceId = await this.store.hInitializeExisting(key, 'huddleInstance', randomUUID(), expected);
      if (!instanceId || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(instanceId)) throw Error('Village unavailable');
      return { instanceId, title: metadata.name };
    }
    const instance = command.instanceId;
    if (!instance || metadata.huddleInstance !== instance) throw Error('Village instance changed');
    if (command.operation === 'presence.list') return this.leases.snapshot(village, instance);
    const user = this.identity(command.userId);
    if (command.operation === 'presence.has') return this.leases.has(village, instance, user);
    const connection = this.identity(command.connectionId);
    if (command.operation === 'presence.join') {
      const player = this.player(command.player);
      this.leases.join(village, instance, user, connection, player);
      this.publish(village, { type: 'PLAYER_JOINED', ...player, userId: user });
      return true;
    }
    if (command.operation === 'presence.renew') {
      const player = command.player ? this.player(command.player) : undefined;
      const renewed = this.leases.renew(village, instance, user, connection, player);
      if (renewed && player) this.publish(village, { type: 'PLAYER_MOVED', ...player, userId: user });
      return renewed;
    }
    if (command.operation === 'presence.release') {
      const released = this.leases.release(village, instance, user, connection);
      if (released) {
        const remaining = this.leases.snapshot(village, instance).find(row => row.userId === user);
        this.publish(village, remaining ? { type: 'PLAYER_MOVED', ...remaining } : { type: 'PLAYER_LEFT', userId: user });
      }
      return released;
    }
    throw Error('Unsupported connection operation');
  }
}
