# AINspace storage gateway

Runs on Ainize, without a Redis client or Redis server.

- `uncommon_gallery_ainspace` stores encrypted map/catalog/permission and legacy frontend records.
- `uncommon_gallery_orchestrator` remains the historical report state application.
- Current conversations stay in AIN Teams. Agent memory stays in AIN Drive.
- Live presence is central TTL memory with SSE. Restarting the gateway forces clients to reconnect and obtain a new snapshot.
- All active frontend state writes must use the gateway. The signer and encryption secret remain on Ainize.

## Setup

Use `provision.mjs` with the existing organization signer on Ainize, then `import-source.mjs` and `verify-source.mjs` against a protected source snapshot. Never publish the configuration or snapshot. Configuration and token files must be owner-readable only.

Build and test with `npm ci`, `npm run build`, and `npm test` under Node 24. After committing, run `deploy.sh` on Ainize. It installs an immutable release and a persistent user service on loopback port 13006. User lingering must be enabled.

The existing private ingress forwards `/api/storage/*` to the gateway; other report APIs keep their original upstream. Install `ingress.mjs` only after its tests pass.

Frontend server-only variables:

- `AINSPACE_STORAGE_URL=https://a2a-orchestration.ainetwork.ai/api/storage`
- `AINSPACE_STORAGE_TOKEN`: the gateway token, set through the deployment secret store.

No deprecated Redis variable, SDK, or fallback is supported. Missing storage fails closed. Single-use auth state, hash mutations, and multi-key deletion use native revision CAS. Large atomic requests are rejected before mutation. Reads can retry transient layer routing failures; writes are never replayed blindly.

## Rollout verification

Verify the complete source snapshot, current source drift, authenticated health, unauthenticated denial, login/permissions, map/catalog state, current conversation flow, and cross-client presence. Remove frontend Redis credentials and disable legacy Redis consumers only after production verification. Keep protected offline backups for recovery.

## Connection-scoped presence (Huddle port)

The private command endpoint also accepts `village.instance` and `presence.join` / `presence.renew` / `presence.release` / `presence.list` / `presence.has`. These are called by the frontend server after account-session authorization, never directly by browsers with the storage token. The gateway rechecks durable village metadata and instance IDs before touching the central connection ledger. Instance initialization and one-use proof claims use native revision CAS.

A connection has a 45-second lease. Only a live connection may renew; a close releases its own ID and preserves other tabs. Village deletion/recreation invalidates the old instance. The ledger intentionally starts empty on gateway restart, requiring fresh client connections. Snapshot/player objects are copied, and per-account/per-village bounds limit memory use.

The current Space frontend still needs its authenticated SSE/position port before these operations are enabled in the product. Do not describe the pure lease tests or the private HTTP tests as real browser/media load verification. See [integration status](../../docs/huddles-main-integration.md).
