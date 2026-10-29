# Huddles main integration scope

2026-10-29: only the independently verified Ainize text adapter and its world-agent/commentary consumers are selected for this main integration. Configuration and provider tests pass and inference never falls back to another AI provider. The current main already contains the native SSO browser handoff and AIN-backed storage migration; those are preserved.

The Redis/Lua-backed concurrent presence and Huddle source authority from feat/kmh/huddles are deliberately retained on that feature branch until they are ported and verified against main's AIN storage service. No Redis dependency or unverified multiplayer/Huddle launch UI is reintroduced here. Image editing and model deployment remain separate; this integration does not enable the unconfigured image-edit route.

The complete cross-repository status is in the Teams HANDOFF.md on feat/kmh/huddles. Main integration must not be reported as full Slack Huddle parity.
