import { introspectSession, readBearerHeader, verifyAppSession, type AppSession } from './ain-integration/app-session';

/** Prefer the live backend session check so logout/suspension is respected. */
async function verifyPresenceSession(token: string) {
  const base = process.env.BACKEND_BASE_URL?.trim().replace(/\/+$/, '');
  return base ? introspectSession(token, base) : verifyAppSession(token);
}

export class VillagePresenceAuthError extends Error {
  constructor(public readonly status: 401 | 403) { super('Presence session unavailable'); }
}

/** Guests have display-only IDs; account IDs always come from a verified session. */
export async function authorizeVillagePresence(
  request: { headers: Headers },
  claimedId: unknown,
  verify: (token: string) => Promise<AppSession | null> = verifyPresenceSession,
): Promise<string> {
  const token = readBearerHeader(request);
  if (token) {
    const session = await verify(token);
    if (!session) throw new VillagePresenceAuthError(401);
    if (claimedId !== undefined && claimedId !== null && claimedId !== session.userId) {
      throw new VillagePresenceAuthError(403);
    }
    return session.userId;
  }
  if (typeof claimedId === 'string' && /^guest:[A-Za-z0-9:_-]{1,160}$/.test(claimedId)) return claimedId;
  throw new VillagePresenceAuthError(401);
}
