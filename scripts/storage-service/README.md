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
