# Huddles main integration scope

2026-10-29: only the independently verified Ainize text adapter and its world-agent/commentary consumers are selected for this main integration. Configuration and provider tests pass and inference never falls back to another AI provider. The current main already contains the native SSO browser handoff and AIN-backed storage migration; those are preserved.

The Redis/Lua-backed concurrent presence and Huddle source authority from feat/kmh/huddles are deliberately retained on that feature branch until they are ported and verified against main's AIN storage service. No Redis dependency or unverified multiplayer/Huddle launch UI is reintroduced here. Image editing and model deployment remain separate; this integration does not enable the unconfigured image-edit route.

The complete cross-repository status is in the Teams HANDOFF.md on feat/kmh/huddles. Main integration must not be reported as full Slack Huddle parity.

## 2026-10-29 AIN storage port in progress

Branch `feat/kmh/huddle-presence-main` starts from merged main `65c34a1`. The previous goal turn merged Teams PR1735; this turn advances the unfinished Space integration. No Redis service/client or Lua execution is reintroduced.

The storage gateway now supports instance-scoped connection leases and private `village.instance` / `presence.join`, `renew`, `release`, `list`, `has` commands. A tab owns its lease; closing an older tab cannot evict a replacement or a different tab. Heartbeats cannot revive expired/released connections, and old village instances cannot mutate replacements. Positions are copied and selected by latest connection update; server limits bound the lease ledger. Deleted village metadata is never recreated by an instance lookup. The existing AIN state writer supplies revision-CAS initialization and one-use nonce claims, so competing gateway writers do not overwrite instances or both consume the same proof. Native CAS behavior is unit-tested with the chain transport double; real AIN deployment/finality is not yet evidence for these changes.

Frontend storage adapters and the four shared Huddle authority/mention endpoints have been ported to this gateway. The existing signed Teams proof and backend-session verification helpers are preserved. Nonces use the atomic gateway claim instead of an ignored Redis NX option. Authorization precedes private membership reads; mention parameters reject duplicates and unknown fields. Frontend server configuration is documented in `.env.example`. Credentials remain server-only.

Verification at this checkpoint: the complete frontend Node suite passes 239 tests; frontend TypeScript passes. The storage service compiles and passes 36 tests, including actual loopback HTTP command/auth tests, connection isolation/expiry and competing CAS writers. Changed production files pass lint. Local work uses no Docker, real media, or model execution. The 50-entry lease test is not a 50-participant media/capacity result.

Still required before enabling or merging Space multiplayer/Huddles: wire authenticated SSE and position updates to connection IDs; retain per-tab ownership through reconnect/account changes; remove unsafe legacy aggregate disconnect cleanup; reconcile TTL expiry events and old-instance events; port the launch controls using the shared Teams interface; test signed authority/SSO and revocation end to end on the current native fixture with the remote browser; then deploy/verify the paired remote gateway. This branch is not a deployed Space Huddle implementation. Broader remaining goal work also includes fresh current-main recording/SSO checks and the previously failed media-capacity trial.

Dependency setup now uses an isolated APFS copy of node_modules in this worktree and the frozen Yarn lock. The previous node_modules symlink into another checkout was removed without modifying its target. The storage-service dependency install is isolated in its own ignored node_modules.
