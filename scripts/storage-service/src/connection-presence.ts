/** Gateway-local connection leases. Durable membership remains in AIN storage.
 * One browser stream owns one lease; reconnects and tabs never share its ID.
 * Callers must authorize the account and current village instance before mutations. */
export interface PresencePlayer {
  x: number; y: number; direction: string; displayName: string; spriteKey: string;
}
type Lease = { player: PresencePlayer; expiresAt: number; order: number };
type Connections = Map<string, Lease>;
type Room = Map<string, Connections>;
export class ConnectionPresence {
  private rooms = new Map<string, Room>();
  private order = 0;
  constructor(private readonly clock: () => number = Date.now, private readonly ttlMs = 45_000) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw Error('Invalid presence lease duration');
  }
  private key(village: string, instance: string): string { return JSON.stringify([village, instance]); }
  private prune(key: string): Room | undefined {
    const room = this.rooms.get(key), now = this.clock();
    if (!room) return;
    for (const [user, connections] of room) {
      for (const [id, lease] of connections) if (lease.expiresAt <= now) connections.delete(id);
      if (!connections.size) room.delete(user);
    }
    if (!room.size) { this.rooms.delete(key); return; }
    return room;
  }
  join(village: string, instance: string, user: string, connection: string, player: PresencePlayer): void {
    const key = this.key(village, instance), room = this.prune(key) ?? new Map<string, Connections>();
    const connections = room.get(user) ?? new Map<string, Lease>();
    if (!connections.has(connection) && (connections.size >= 64 || [...room.values()].reduce((n, c) => n + c.size, 0) >= 1024)) {
      throw Error('Presence connection limit reached');
    }
    connections.set(connection, { player: { ...player }, expiresAt: this.clock() + this.ttlMs, order: ++this.order });
    room.set(user, connections); this.rooms.set(key, room);
  }
  renew(village: string, instance: string, user: string, connection: string, player?: PresencePlayer): boolean {
    const lease = this.prune(this.key(village, instance))?.get(user)?.get(connection);
    if (!lease) return false;
    lease.expiresAt = this.clock() + this.ttlMs;
    if (player) { lease.player = { ...player }; lease.order = ++this.order; }
    return true;
  }
  release(village: string, instance: string, user: string, connection: string): boolean {
    const key = this.key(village, instance), room = this.prune(key), connections = room?.get(user);
    if (!connections?.delete(connection)) return false;
    if (!connections.size) room!.delete(user);
    if (!room!.size) this.rooms.delete(key);
    return true;
  }
  snapshot(village: string, instance: string): Array<PresencePlayer & { userId: string }> {
    const room = this.prune(this.key(village, instance));
    return [...(room ?? [])].map(([userId, connections]) => {
      const latest = [...connections.values()].reduce((a, b) => a.order > b.order ? a : b);
      return { ...latest.player, userId };
    });
  }
  has(village: string, instance: string, user: string): boolean {
    return !!this.prune(this.key(village, instance))?.get(user)?.size;
  }
  /** Village deletion/recreation invalidates its leases; a new gateway starts empty. */
  invalidate(village: string, instance: string): void { this.rooms.delete(this.key(village, instance)); }
  sweep(): void { for (const key of this.rooms.keys()) this.prune(key); }
}
