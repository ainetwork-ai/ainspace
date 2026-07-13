// EPIC21: conversationId <-> orchestrator threadId mapping — ainspace-side ONLY.
//
// The frozen contract fixes `thread.id == orchestrator thread id`, and ainspace
// already uses the backend conversationId verbatim as its `Thread.id`, so the
// default mapping is IDENTITY. This function is the single choke point every
// call site routes through, so a future relocation (reports moving to the shared
// backend + Notion) has exactly one place to change instead of touching every
// dual-write hook.
//
// INVARIANT: this mapping is NEVER persisted in the shared backend. It stays
// ainspace-side (a module constant today; localStorage if a non-identity mapping
// is ever needed — see the stub below).

export function orchestratorThreadId(conversationId: string): string {
  // Identity mapping. If a non-identity mapping ever becomes necessary, replace
  // ONLY this function body with an ainspace-side lookup, e.g.:
  //
  //   if (typeof window !== 'undefined') {
  //     const mapped = window.localStorage.getItem(`orch-thread:${conversationId}`);
  //     if (mapped) return mapped;
  //   }
  //   return conversationId;
  //
  // (and a sibling `setOrchestratorThreadId(conversationId, threadId)` writing the
  // same localStorage key). Do NOT store the mapping in the shared backend.
  return conversationId;
}
