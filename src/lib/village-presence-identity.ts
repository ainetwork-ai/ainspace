/** Presence identity follows the authenticated account; guest identity stays local. */
export function villagePresenceIdentity(state: {
  isBackendAuthed: boolean;
  backendUser: { id: string } | null;
  getUserId(): string | null;
}): string | null {
  if (state.isBackendAuthed && state.backendUser?.id) return state.backendUser.id;
  const guestId = state.getUserId();
  return guestId ? `guest:${guestId}` : null;
}
