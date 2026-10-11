import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes } from "node:crypto";

export interface StateValue {
  key: string;
  type: "string" | "set" | "hash";
  value: string | string[] | Record<string, string>;
  expiresAt: number | null;
}
export interface StateHead {
  version: 1;
  revision: string;
  chunks: number;
  sha256: string;
}
export interface SealedState {
  recordId: string;
  head: StateHead;
  chunks: string[];
}

// A header is published only after its immutable chunks have been confirmed on chain.
// Transport must additionally check the full signed transaction size against chain limits.
const CHUNK_BYTES = 3072;
const MAX_BYTES = 64 * 1024 * 1024;
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export class EncryptedStateCodec {
  private readonly encryptionKey: Buffer;
  private readonly indexKey: Buffer;
  constructor(private readonly organization: string, secret: Buffer) {
    if (!organization || secret.length !== 32) throw Error("Organization and a 32-byte state encryption key are required");
    this.encryptionKey = Buffer.from(hkdfSync("sha256", secret, organization, "orchestrator-state/encryption/v1", 32));
    this.indexKey = Buffer.from(hkdfSync("sha256", secret, organization, "orchestrator-state/index/v1", 32));
  }
  recordId(key: string): string {
    if (!key) throw Error("State key must not be empty");
    return createHmac("sha256", this.indexKey).update(key).digest("hex");
  }
  private aad(recordId: string, revision: string): Buffer {
    return Buffer.from(JSON.stringify([1, this.organization, recordId, revision]));
  }
  seal(state: StateValue): SealedState {
    this.validate(state);
    const plaintext = Buffer.from(JSON.stringify(state));
    if (plaintext.length > MAX_BYTES) throw Error("State value exceeds the encryption size limit");
    const recordId = this.recordId(state.key), revision = randomBytes(16).toString("hex"), nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, nonce);
    cipher.setAAD(this.aad(recordId, revision));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope = Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
    const chunks: string[] = [];
    for (let i = 0; i < envelope.length; i += CHUNK_BYTES) chunks.push(envelope.subarray(i, i + CHUNK_BYTES).toString("base64"));
    return { recordId, head: { version: 1, revision, chunks: chunks.length, sha256: digest(envelope) }, chunks };
  }
  open(key: string, head: StateHead, chunks: string[]): StateValue {
    const state = this.openRecord(this.recordId(key), head, chunks);
    if (state.key !== key) throw Error("Encrypted state key mismatch");
    return state;
  }
  openRecord(recordId: string, head: StateHead, chunks: string[]): StateValue {
    if (!/^[a-f0-9]{64}$/.test(recordId)) throw Error("Invalid encrypted state record ID");
    if (head.version !== 1 || !/^[a-f0-9]{32}$/.test(head.revision) || !/^[a-f0-9]{64}$/.test(head.sha256)
      || !Number.isInteger(head.chunks) || head.chunks < 1 || head.chunks > Math.ceil((MAX_BYTES + 28) / CHUNK_BYTES)
      || chunks.length !== head.chunks) throw Error("Invalid encrypted state header");
    const buffers = chunks.map((chunk, i) => {
      if (!chunk.length || chunk.length > CHUNK_BYTES / 3 * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(chunk)) throw Error("Invalid encrypted state chunk");
      const bytes = Buffer.from(chunk, "base64");
      if (bytes.toString("base64") !== chunk || (i < chunks.length - 1 && bytes.length !== CHUNK_BYTES)) throw Error("Invalid encrypted state chunk");
      return bytes;
    });
    const envelope = Buffer.concat(buffers);
    if (envelope.length < 28 || envelope.length > MAX_BYTES + 28 || digest(envelope) !== head.sha256) throw Error("Encrypted state chunks are incomplete or corrupt");
    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, envelope.subarray(0, 12));
    decipher.setAAD(this.aad(recordId, head.revision));
    decipher.setAuthTag(envelope.subarray(12, 28));
    const plaintext = Buffer.concat([decipher.update(envelope.subarray(28)), decipher.final()]);
    const state: StateValue = JSON.parse(plaintext.toString("utf8"));
    this.validate(state);
    if (this.recordId(state.key) !== recordId) throw Error("Encrypted state key mismatch");
    return state;
  }
  private validate(state: StateValue): void {
    if (!state || typeof state.key !== "string" || !state.key
      || (state.expiresAt !== null && (!Number.isSafeInteger(state.expiresAt) || state.expiresAt < 0))
      || (state.type === "string" ? typeof state.value !== "string"
        : state.type === "hash" ? !state.value || Array.isArray(state.value) || typeof state.value !== "object"
          || Object.values(state.value).some(value => typeof value !== "string")
        : state.type !== "set" || !Array.isArray(state.value) || state.value.some(member => typeof member !== "string")
          || new Set(state.value).size !== state.value.length)) throw Error("Invalid state value");
  }
}
