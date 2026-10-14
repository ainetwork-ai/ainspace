import Ain from "@ainblockchain/ain-js";

export interface ChainOperation { type: "SET_VALUE"; ref: string; value: unknown }
export interface StateChainTransport {
  readonly operationJsonBytesLimit?: number;
  readonly operationCountLimit?: number;
  childLabels?(ref: string): Promise<string[]>;
  get<T>(ref: string): Promise<T | null>;
  write(operations: ChainOperation[]): Promise<void>;
}
export class AinWriteRejected extends Error {}
export interface AinTransportConfig {
  rpcUrl: string;
  chainId: number;
  genesisHash: string;
  privateKey: string;
  gasPrice: number;
  transactionBytesLimit: number;
  finalityTimeoutMs?: number;
}
export class AinTransport implements StateChainTransport {
  private readonly ain: Ain;
  private timestamp = 0;
  private activeRpc = 0;
  private waitingRpc: (() => void)[] = [];
  readonly address: string;
  readonly operationJsonBytesLimit: number;
  readonly operationCountLimit = 50;
  constructor(private readonly config: AinTransportConfig) {
    const url = new URL(config.rpcUrl);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash
      || !Number.isSafeInteger(config.chainId) || config.chainId < 0
      || !/^0x[a-f0-9]{64}$/.test(config.genesisHash)
      || !/^[a-fA-F0-9]{64}$/.test(config.privateKey)
      || !Number.isSafeInteger(config.gasPrice) || config.gasPrice < 0
      || !Number.isSafeInteger(config.transactionBytesLimit) || config.transactionBytesLimit < 10000) throw Error("Invalid AIN state transport configuration");
    this.ain = new Ain(url.origin, undefined, config.chainId);
    this.address = this.ain.wallet.addAndSetDefaultAccount(config.privateKey);
    this.operationJsonBytesLimit = Math.floor((config.transactionBytesLimit - 1024) / 2) - 256;
  }
  async rpc<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.activeRpc < 8) this.activeRpc++;
    else await new Promise<void>(resolve => this.waitingRpc.push(resolve));
    try {
      const readonly = method.startsWith("ain_get") || method.startsWith("net_get");
      for (let attempt = 0; ; attempt++) {
        const response = await fetch(this.config.rpcUrl, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params, protoVer: "1.6.1" } }),
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw Error(`AIN RPC HTTP ${response.status}`);
        const envelope = await response.json() as { error?: { code: number; message?: string }; result?: { code?: number; result?: T } };
        // The layer router can briefly lose its upstream. Retry reads only;
        // a submitted write may already exist and must never be replayed blindly.
        if (readonly && envelope.error?.code === -32050 && attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, [200, 800, 1800][attempt]));
          continue;
        }
        if (envelope.error || !envelope.result || (envelope.result.code !== undefined && envelope.result.code !== 0)
          || !Object.prototype.hasOwnProperty.call(envelope.result, "result")) throw Error(`AIN RPC rejected ${method} (code ${envelope.error?.code ?? envelope.result?.code ?? "missing-result"})`);
        return envelope.result.result as T;
      }
    } finally {
      const next = this.waitingRpc.shift();
      if (next) next(); else this.activeRpc--;
    }
  }
  async verifyNetwork(): Promise<void> {
    const chain = await this.rpc<number>("net_getChainId");
    const genesis = await this.rpc<{ hash: string }>("ain_getBlockByNumber", { number: 0, getFullTransactions: false });
    if (chain !== this.config.chainId || genesis?.hash !== this.config.genesisHash) throw Error("AIN chain identity mismatch");
    const limit = await this.get<number>("/blockchain_params/resource/tx_bytes_limit");
    const count = await this.get<number>("/blockchain_params/resource/set_op_list_size_limit");
    if (count !== this.operationCountLimit) throw Error("AIN operation count limit changed");
    if (limit !== this.config.transactionBytesLimit) throw Error("AIN transaction size configuration mismatch");
  }
  get<T>(ref: string): Promise<T | null> {
    return this.rpc("ain_get", { type: "GET_VALUE", ref, is_final: true });
  }
  async childLabels(ref: string): Promise<string[]> {
    const labels: string[] = [], seen = new Set<string>(), cursors = new Set<string>();
    let cursor: string | undefined;
    for (let pageNumber = 0; pageNumber < 100000; pageNumber++) {
      const page = await this.rpc<Record<string, unknown> | null>("ain_get", {
        type: "GET_VALUE", ref, is_final: true, is_partial: true, is_shallow: true,
        ...(cursor === undefined ? {} : { last_end_label: cursor }),
      });
      if (page === null) return labels;
      if (typeof page !== "object" || Array.isArray(page)) throw Error("Invalid AIN child listing");
      const children = Object.keys(page).filter(label => !label.startsWith("#"));
      for (const label of children) {
        if (seen.has(label)) throw Error("AIN child listing repeated a record");
        seen.add(label); labels.push(label);
      }
      const next = page["#end_label"];
      if (!children.length || next === undefined) return labels;
      if (typeof next !== "string" || !next || cursors.has(next)) throw Error("AIN child listing cursor did not advance");
      cursors.add(next); cursor = next;
    }
    throw Error("AIN child listing exceeded the page limit");
  }
  async write(operations: ChainOperation[]): Promise<void> {
    if (!operations.length) return;
    if (operations.length > this.operationCountLimit) throw Error("AIN operation count exceeds the atomic transaction limit");
    this.timestamp = Math.max(Date.now(), this.timestamp + 1);
    const txBody = { operation: { type: "SET" as const, op_list: operations }, nonce: -1, timestamp: this.timestamp, gas_price: this.config.gasPrice };
    // The native node measures JS strings as UTF-16. This conservative bound leaves
    // room for property names/numbers and prevents sending an oversized body.
    if (Buffer.byteLength(JSON.stringify(txBody)) * 2 + 1024 > this.config.transactionBytesLimit) throw Error("AIN transaction exceeds conservative size bound");
    const signature = this.ain.wallet.signTransaction(txBody);
    const result = await this.rpc<{ tx_hash: string; result: { code?: number; result_list?: Record<string, { code: number }> } }>(
      "ain_sendSignedTransaction", { tx_body: txBody, signature });
    const successful = (value: typeof result.result | undefined) => !!value && (value.result_list
      ? Object.values(value.result_list).every(entry => entry.code === 0) : value.code === 0);
    if (!result?.tx_hash || !successful(result.result)) throw new AinWriteRejected("AIN state write was rejected");
    const deadline = Date.now() + (this.config.finalityTimeoutMs ?? 60000);
    while (Date.now() < deadline) {
      const info = await this.rpc<{ is_finalized: boolean; state: string; receipt?: typeof result.result } | null>("ain_getTransactionByHash", { hash: result.tx_hash });
      if (info?.is_finalized) {
        if (info.state !== "FINALIZED" || !successful(info.receipt)) throw Error("AIN state write reverted at finality");
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw Error("AIN state write finality timed out; commit is unconfirmed");
  }
}
