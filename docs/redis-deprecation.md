# Redis deprecation

Scope: Ainspace production storage, auth and presence; migrated report orchestrator; deployment credentials and dependencies. No Redis fallback is permitted after cutover.

## Current evidence
- Production frontend main fc0bd72 still imports Redis in catalog, villages, position, auth, OAuth state, tasks and presence.
- Report orchestrator durable state already uses encrypted AIN Blockchain state with revision CAS.
- Ainscan is not proof that current Teams messages are recorded on chain. Teams remains the authoritative current conversation store.

## Replacement
- Use the separate organization application `uncommon_gallery_ainspace` for encrypted durable frontend state through an authenticated Ainize-hosted gateway. Historical reports remain in `uncommon_gallery_orchestrator`. Private keys remain on Ainize.
- Short-lived presence and publish/subscribe are served by one central gateway with TTL and SSE, without chain writes per movement.
- OAuth single-use state and hash changes require CAS atomicity.
- Preserve original keys, TTLs, auth ownership, user IDs, agent URLs, map layout and membership.
- Fail closed on auth storage failures; never replace durable storage with an in-memory fallback.

## Completion gates
- [ ] Inventory every Redis consumer and source deployment.
- [ ] Authenticated gateway with bounded input, TTL, hashes, sets and subscriptions.
- [ ] Concurrent atomic operations and disconnect/restart tests pass.
- [ ] Complete source snapshot with TTL, keys, type and integrity manifest.
- [ ] Frontend uses gateway exclusively; Redis SDK and env credentials removed.
- [ ] Imported records match source before final cutover.
- [ ] Production login, maps, agent lookup, conversation and two-client presence verified.
- [ ] Source Redis stopped only after verifying no remaining shared consumers.
- [ ] Production dependency, code and runtime audit proves no Redis use.
