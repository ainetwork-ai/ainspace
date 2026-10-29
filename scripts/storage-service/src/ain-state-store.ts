import { randomBytes } from "node:crypto";
import { EncryptedStateCodec, StateHead, StateValue } from "./encrypted-state";
import { AinWriteRejected, ChainOperation, StateChainTransport } from "./ain-transport";

interface StoredHead extends StateHead { previousRevision: string | null; deleted?: boolean; namespace?: string }
class StateRevisionConflict extends Error {}
export class StateBatchTooLarge extends Error {}
/** Install this exact rule at heads/$recordId before enabling the adapter. */
export function stateHeadWriteRule(address: string): string {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) throw Error("Invalid state signer address");
  return `auth.addr === '${address}' && util.isDict(newData) && util.checkValuePathLen(parsedValuePath, 5) === true && newData.previousRevision === (data === null ? null : data.revision) && newData.revision !== (data === null ? null : data.revision)`;
}
export function stateChunksWriteRule(address: string): string {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) throw Error("Invalid state signer address");
  return `auth.addr === '${address}' && data === null && util.isString(newData) && util.checkValuePathLen(parsedValuePath, 7) === true`;
}

export class AinStateStore {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly cache = new Map<string, { revision: string; state: StateValue }>();
  constructor(private readonly chain: StateChainTransport, private readonly codec: EncryptedStateCodec,
    private readonly root: string, private readonly clock = Date.now, private readonly namespace?: string) {
    if (!/^\/apps\/[a-zA-Z0-9_]+\/state$/.test(root)) throw Error("State root must be an organization app's state path");
  }
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(action, action);
    this.queue = pending.catch(() => {});
    return pending;
  }
  private headPath(id: string) { return `${this.root}/heads/${id}`; }
  private async read(id: string, knownHead?: StoredHead): Promise<{ head: StoredHead | null; state: StateValue | null }> {
    const head = knownHead ?? await this.chain.get<StoredHead>(this.headPath(id));
    if (!head || head.deleted) { this.cache.delete(id); return { head, state: null }; }
    const cached = this.cache.get(id);
    let state: StateValue;
    if (cached?.revision === head.revision) state = cached.state;
    else {
      // Reject untrusted sizes before allocating requests for a forged header.
      if (!Number.isInteger(head.chunks) || head.chunks < 1 || head.chunks > 21846) throw Error("Invalid AIN state chunk count");
      const chunks: string[] = [];
      for (let index = 0; index < head.chunks; index++) {
        const chunk = await this.chain.get<string>(`${this.root}/chunks/${id}/${head.revision}/${index}`);
        if (typeof chunk !== "string") throw Error("Committed AIN state is missing a chunk");
        chunks.push(chunk);
      }
      state = this.codec.openRecord(id, head, chunks);
      this.cache.set(id, { revision: head.revision, state });
    }
    return { head, state: state.expiresAt !== null && state.expiresAt <= this.clock() ? null : state };
  }
  private async commit(key: string, previous: StoredHead | null, state: StateValue | null): Promise<void> {
    const id = this.codec.recordId(key);
    let head: StoredHead;
    const operations: ChainOperation[] = [];
    if (state) {
      const sealed = this.codec.seal(state);
      for (let index = 0; index < sealed.chunks.length; index++) {
        operations.push({ type: "SET_VALUE", ref: `${this.root}/chunks/${id}/${sealed.head.revision}/${index}`, value: sealed.chunks[index] });
      }
      head = { ...sealed.head, previousRevision: previous?.revision ?? null };
    } else head = { version: 1, revision: randomBytes(16).toString("hex"), chunks: 0, sha256: "0".repeat(64), previousRevision: previous?.revision ?? null, deleted: true };
    // The on-chain rule compares previousRevision at execution, including other
    // processes. A read/check alone cannot provide this guarantee.
    if (this.namespace) head.namespace = this.namespace;
    operations.push({ type: "SET_VALUE", ref: this.headPath(id), value: head });
    try {
      // Confirm chunk batches in order; publish the header in the last batch.
      // Normal small records commit all chunks and the CAS header together.
      const budget = this.chain.operationJsonBytesLimit ?? 4500;
      let batch: ChainOperation[] = [];
      for (const operation of operations) {
        if (batch.length && Buffer.byteLength(JSON.stringify([...batch, operation])) > budget) {
          await this.chain.write(batch); batch = [];
        }
        if (Buffer.byteLength(JSON.stringify([operation])) > budget) throw Error("AIN state operation exceeds the transaction size bound");
        batch.push(operation);
      }
      if (batch.length) await this.chain.write(batch);
    }
    catch (error) {
      if (error instanceof AinWriteRejected) {
        const latest = await this.chain.get<StoredHead>(this.headPath(id));
        if (latest?.revision !== previous?.revision && latest?.revision !== head.revision) throw new StateRevisionConflict("AIN state revision changed");
      }
      throw error;
    }
    this.cache.delete(id);
  }
  private async change<T>(key: string, modify: (current: StateValue | null) => { state: StateValue | null; result: T; unchanged?: boolean }): Promise<T> {
    const id = this.codec.recordId(key);
    for (let attempt = 0; ; attempt++) {
      const current = await this.read(id), change = modify(current.state);
      if (change.unchanged) return change.result;
      try { await this.commit(key, current.head, change.state); return change.result; }
      catch (error) {
        // Network/finality failures are ambiguous and must never become a pass.
        if (attempt >= 4 || !(error instanceof StateRevisionConflict)) throw error;
      }
    }
  }
  async get(key: string): Promise<string | null> {
    const { state } = await this.read(this.codec.recordId(key));
    if (!state) return null;
    if (state.type !== "string") throw Error("WRONGTYPE state value is not a string");
    return state.value as string;
  }
  /** One-use proof claims share the same native CAS as auth-state consumption. */
  setNxEx(key: string, seconds: number, value: string): Promise<'OK' | null> {
    if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 86400) return Promise.reject(Error('Invalid claim expiry'));
    return this.serialize(() => this.change<'OK' | null>(key, current => current
      ? { result: null, unchanged: true, state: current }
      : { result: 'OK', state: { key, type: 'string', value, expiresAt: this.clock() + seconds * 1000 } }));
  }
  mGet(keys: string[]): Promise<(string | null)[]> { return Promise.all(keys.map(key => this.get(key))); }
  set(key: string, value: string): Promise<string> {
    return this.serialize(() => this.change(key, () => ({ state: { key, type: "string", value, expiresAt: null }, result: "OK" })));
  }
  setEx(key: string, seconds: number, value: string): Promise<string> {
    if (!Number.isSafeInteger(seconds) || seconds <= 0) return Promise.reject(Error("Invalid state expiry"));
    const expiresAt = this.clock() + seconds * 1000;
    return this.serialize(() => this.change(key, () => ({ state: { key, type: "string", value, expiresAt }, result: "OK" })));
  }
  sMembers(key: string): Promise<string[]> {
    return this.read(this.codec.recordId(key)).then(({ state }) => {
      if (!state) return [];
      if (state.type !== "set") throw Error("WRONGTYPE state value is not a set");
      return [...state.value as string[]];
    });
  }
  private setMutation(key: string, members: string | string[], remove: boolean): Promise<number> {
    const values = typeof members === "string" ? [members] : members;
    return this.serialize(() => this.change(key, current => {
      if (current && current.type !== "set") throw Error("WRONGTYPE state value is not a set");
      const result = new Set(current?.value as string[] ?? []); let changed = 0;
      for (const value of values) {
        if (remove) { if (result.delete(value)) changed++; }
        else if (!result.has(value)) { result.add(value); changed++; }
      }
      return { result: changed, unchanged: changed === 0, state: result.size ? { key, type: "set", value: [...result], expiresAt: current?.expiresAt ?? null } : null };
    }));
  }
  sAdd(key: string, members: string | string[]) { return this.setMutation(key, members, false); }
  sRem(key: string, members: string | string[]) { return this.setMutation(key, members, true); }
  /** Hash updates are one CAS revision, including concurrent writers. */
  hSet(key: string, field: string | Record<string, string>, value?: string): Promise<number> {
    const fields = typeof field === "string" ? { [field]: value! } : field;
    if (Object.values(fields).some(v => typeof v !== "string")) return Promise.reject(Error("Invalid hash value"));
    return this.serialize(() => this.change(key, current => {
      if (current && current.type !== "hash") throw Error("WRONGTYPE state value is not a hash");
      const previous = current?.value as Record<string, string> | undefined;
      const next = Object.assign(Object.create(null), previous ?? {}, fields) as Record<string, string>;
      const added = Object.keys(fields).filter(f => !Object.hasOwn(previous ?? {}, f)).length;
      const unchanged = !!current && Object.entries(fields).every(([f, v]) => previous?.[f] === v);
      return { result: added, unchanged, state: { key, type: "hash", value: next, expiresAt: current?.expiresAt ?? null } };
    }));
  }
  /** Initialize a field only in an existing matching hash under native revision CAS.
   * Delayed initialization cannot recreate deleted metadata or replace an instance. */
  hInitializeExisting(key: string, field: string, value: string, expected: Record<string, string>): Promise<string | null> {
    if (!field || typeof value !== 'string' || Object.values(expected).some(v => typeof v !== 'string')) {
      return Promise.reject(Error('Invalid hash initialization'));
    }
    return this.serialize(() => this.change<string | null>(key, current => {
      if (!current || current.type !== 'hash') return { result: null, unchanged: true, state: current };
      const previous = current.value as Record<string, string>;
      if (!Object.entries(expected).every(([f, v]) => Object.hasOwn(previous, f) && previous[f] === v)) {
        return { result: null, unchanged: true, state: current };
      }
      if (Object.hasOwn(previous, field)) return { result: previous[field], unchanged: true, state: current };
      return { result: value, state: { ...current, value: Object.assign(Object.create(null), previous, { [field]: value }) } };
    }));
  }
  async hGetAll(key: string): Promise<Record<string, string>> {
    const { state } = await this.read(this.codec.recordId(key));
    if (!state) return {};
    if (state.type !== "hash") throw Error("WRONGTYPE state value is not a hash");
    return { ...state.value as Record<string, string> };
  }
  async hGet(key: string, field: string): Promise<string | null> {
    const fields = await this.hGetAll(key);
    return Object.hasOwn(fields, field) ? fields[field] : null;
  }
  async hLen(key: string): Promise<number> { return Object.keys(await this.hGetAll(key)).length; }
  hDel(key: string, fields: string | string[]): Promise<number> {
    return this.serialize(() => this.change(key, current => {
      if (current && current.type !== "hash") throw Error("WRONGTYPE state value is not a hash");
      const next = { ...current?.value as Record<string, string> };
      let removed = 0;
      for (const field of typeof fields === "string" ? [fields] : fields) {
        if (Object.hasOwn(next, field)) { delete next[field]; removed++; }
      }
      return { result: removed, unchanged: removed === 0, state: Object.keys(next).length ? { key, type: "hash", value: next, expiresAt: current?.expiresAt ?? null } : null };
    }));
  }
  /** Consuming OAuth state must be atomic across replicas, never read-then-delete. */
  getDel(key: string): Promise<string | null> {
    return this.serialize(() => this.change(key, current => {
      if (current && current.type !== "string") throw Error("WRONGTYPE state value is not a string");
      return { result: current?.value as string ?? null, state: null, unchanged: !current };
    }));
  }
  expire(key: string, seconds: number): Promise<number> {
    if (!Number.isSafeInteger(seconds)) return Promise.reject(Error("Invalid state expiry"));
    return this.serialize(() => this.change(key, current => ({
      result: current ? 1 : 0, unchanged: !current,
      state: current && seconds > 0 ? { ...current, expiresAt: this.clock() + seconds * 1000 } : null,
    })));
  }
  /** Import disjoint records in one native atomic SET, respecting operation and byte limits. */
  putBatch(records: StateValue[]): Promise<number> {
    if (new Set(records.map(record => record.key)).size !== records.length) return Promise.reject(Error("Duplicate batch state key"));
    return this.serialize(async () => {
      for (let attempt = 0; ; attempt++) {
        const previous = await Promise.all(records.map(record => this.read(this.codec.recordId(record.key))));
        const operations: ChainOperation[] = [];
        const headers: ChainOperation[] = [];
        const changed: number[] = [];
        const canonical = (state: StateValue | null) => state === null ? "null" : JSON.stringify({
          ...state, value: state.type === "hash" ? Object.fromEntries(Object.entries(state.value).sort(([a],[b]) => a.localeCompare(b))) : state.type === "set" ? [...state.value as string[]].sort() : state.value,
        });
        for (let index = 0; index < records.length; index++) {
          const record = records[index];
          if (canonical(previous[index].state) === canonical(record)) continue;
          const sealed = this.codec.seal(record), id = sealed.recordId;
          sealed.chunks.forEach((value, chunk) => operations.push({ type: "SET_VALUE", ref: `${this.root}/chunks/${id}/${sealed.head.revision}/${chunk}`, value }));
          headers.push({ type: "SET_VALUE", ref: this.headPath(id), value: { ...sealed.head, previousRevision: previous[index].head?.revision ?? null, ...(this.namespace ? { namespace: this.namespace } : {}) } });
          changed.push(index);
        }
        operations.push(...headers);
        if (!operations.length) return 0;
        if (operations.length > (this.chain.operationCountLimit ?? 50) || Buffer.byteLength(JSON.stringify(operations)) > (this.chain.operationJsonBytesLimit ?? 4500)) {
          if (records.length === 1) {
            await this.change(records[0].key, () => ({ state: records[0], result: 1 }));
            return 1;
          }
          throw new StateBatchTooLarge("Atomic state batch exceeds chain limits");
        }
        try { await this.chain.write(operations); }
        catch (error) {
          if (!(error instanceof AinWriteRejected) || attempt >= 4) throw error;
          const latest = await Promise.all(changed.map(index => this.chain.get<StoredHead>(this.headPath(this.codec.recordId(records[index].key)))));
          if (!latest.some((head,index) => head?.revision !== previous[changed[index]].head?.revision)) throw error;
          continue;
        }
        for (const index of changed) this.cache.delete(this.codec.recordId(records[index].key));
        return changed.length;
      }
    });
  }
  async del(keys: string | string[]): Promise<number> {
    const unique = [...new Set(typeof keys === "string" ? [keys] : keys)];
    return this.serialize(async () => {
      for (let attempt = 0; ; attempt++) {
        const current = await Promise.all(unique.map(async key => ({ id: this.codec.recordId(key), ...(await this.read(this.codec.recordId(key))) })));
        const present = current.filter(record => record.state !== null);
        if (!present.length) return 0;
        const operations: ChainOperation[] = present.map(record => ({
          type: "SET_VALUE", ref: this.headPath(record.id),
          value: { version: 1, revision: randomBytes(16).toString("hex"), chunks: 0, sha256: "0".repeat(64), previousRevision: record.head?.revision ?? null, deleted: true, ...(this.namespace ? { namespace: this.namespace } : {}) },
        }));
        if (operations.length > (this.chain.operationCountLimit ?? 50)) throw Error("Atomic delete exceeds operation count bound");
        if (Buffer.byteLength(JSON.stringify(operations)) > (this.chain.operationJsonBytesLimit ?? 4500)) throw Error("Atomic delete exceeds transaction size bound");
        try { await this.chain.write(operations); }
        catch (error) {
          if (!(error instanceof AinWriteRejected) || attempt >= 4) throw error;
          const latest = await Promise.all(present.map(record => this.chain.get<StoredHead>(this.headPath(record.id))));
          if (!latest.some((head,index) => head?.revision !== present[index].head?.revision)) throw error;
          continue;
        }
        for (const record of present) this.cache.delete(record.id);
        return present.length;
      }
    });
  }
  async keys(pattern: string): Promise<string[]> {
    if (pattern.includes("?") || pattern.includes("[") || pattern.includes("\\")) throw Error("Unsupported state key pattern");
    const regex = new RegExp("^" + pattern.split("*").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
    const heads: Record<string, StoredHead> = {};
    if (this.chain.childLabels) {
      const ids = await this.chain.childLabels(`${this.root}/heads`);
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(16, ids.length) }, async () => {
        while (cursor < ids.length) {
          const id = ids[cursor++];
          const head = await this.chain.get<StoredHead>(this.headPath(id));
          if (head) heads[id] = head;
        }
      }));
    } else Object.assign(heads, await this.chain.get<Record<string, StoredHead>>(`${this.root}/heads`) ?? {});
    const result: string[] = [];
    const ids = Object.keys(heads).filter(id => !heads[id].deleted && (!this.namespace || heads[id].namespace === this.namespace));
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(16, ids.length) }, async () => {
      while (cursor < ids.length) {
        const id = ids[cursor++];
        const { state } = await this.read(id, heads[id]);
        if (state && regex.test(state.key)) result.push(state.key);
      }
    }));
    return result;
  }
  async type(key: string): Promise<string> { return (await this.read(this.codec.recordId(key))).state?.type ?? "none"; }
  async exists(key: string): Promise<number> { return (await this.read(this.codec.recordId(key))).state ? 1 : 0; }
  async sCard(key: string): Promise<number> { return (await this.sMembers(key)).length; }
  async *scanIterator(options: { MATCH?: string; COUNT?: number } = {}): AsyncGenerator<string> {
    for (const key of await this.keys(options.MATCH ?? "*")) yield key;
  }
  multi() {
    const operations: { key: string; seconds: number; value: string }[] = [];
    const pipeline = {
      setEx: (key: string, seconds: number, value: string) => { operations.push({ key, seconds, value }); return pipeline; },
      // Used only for disposable embedding cache batches; durable state commits
      // individually and failures propagate rather than falling back to Redis.
      exec: async () => { const results: string[] = []; for (const op of operations) results.push(await this.setEx(op.key, op.seconds, op.value)); return results; },
    };
    return pipeline;
  }
  async quit(): Promise<void> { await this.queue; this.cache.clear(); }
}
