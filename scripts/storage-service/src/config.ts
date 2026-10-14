import { readFileSync, statSync } from "node:fs";
import { AinTransport, AinTransportConfig } from "./ain-transport";
import { AinStateStore, stateChunksWriteRule, stateHeadWriteRule } from "./ain-state-store";
import { EncryptedStateCodec } from "./encrypted-state";

interface StateConfig extends AinTransportConfig {
  organizationId: string;
  application: string;
  encryptionKey: string;
}
export async function createAinStateStore(path: string): Promise<AinStateStore> {
  if (!path) throw Error("AIN_STATE_CONFIG is required for Blockchain state");
  const file = statSync(path);
  if (!file.isFile() || (file.mode & 0o077) !== 0 || (process.getuid && file.uid !== process.getuid())) throw Error("AIN state configuration must be private and owned by the service user");
  const config: StateConfig = JSON.parse(readFileSync(path, "utf8"));
  if (config.application !== "uncommon_gallery_ainspace") throw Error("Frontend state requires its own application");
  if (!config.organizationId || !/^[a-zA-Z0-9_]+$/.test(config.application) || !/^[a-fA-F0-9]{64}$/.test(config.encryptionKey)) throw Error("Invalid organization state configuration");
  const chain = new AinTransport(config);
  await chain.verifyNetwork();
  const root = `/apps/${config.application}/state`;
  const metadata = await chain.get<{ organizationId: string }>(`/apps/${config.application}/state_metadata`);
  if (metadata?.organizationId !== config.organizationId) throw Error("AIN state application organization mismatch");
  for (const [ref, expected] of [
    [root, false],
    [`${root}/heads/$recordId`, stateHeadWriteRule(chain.address)],
    [`${root}/chunks/$recordId/$revision/$index`, stateChunksWriteRule(chain.address)],
  ] as const) {
    const rule = await chain.rpc<{ ".rule"?: { write: unknown } } | null>("ain_get", { type: "GET_RULE", ref, is_final: true });
    if (rule?.[".rule"]?.write !== expected) throw Error("AIN state write rules are not provisioned correctly");
  }
  return new AinStateStore(chain, new EncryptedStateCodec(config.organizationId, Buffer.from(config.encryptionKey, "hex")), root, Date.now, "ainspace");
}
