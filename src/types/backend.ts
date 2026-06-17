// Types for the new NestJS backend JWT auth (consumed via the ainspace BFF).
// Source of truth: docs/ainspace-integration-guide.md

export interface BackendUser {
  id: string;
  displayName: string;
  ainAddress: string;
  avatarUrl: string | null;
}

export interface BackendTokens {
  accessToken: string;
  // EPIC26: refresh is delivered via the httpOnly `rt` cookie, not the body.
  // Optional for legacy/non-browser responses that still include it.
  refreshToken?: string;
  expiresIn: number;
}

export interface ChallengeResponse {
  nonce: string;
  message: string;
}

export interface VerifyResponse {
  user: BackendUser;
  tokens: BackendTokens;
}

export interface RefreshResponse {
  accessToken: string;
  // EPIC26: rotated refresh comes via Set-Cookie, not the body.
  refreshToken?: string;
  expiresIn: number;
}

// Browser -> BFF verify payload. `clientId` is injected server-side by the BFF.
export interface BrowserVerifyRequest {
  signature: string;
  address: string;
  provider: 'eth' | 'metamask' | 'ain';
  walletType: 'smart' | 'eoa';
  challengeNonce: string;
}

// --- EPIC20: email (ainteams) auth -----------------------------------------
// register/login return the same { user, tokens } shape as wallet verify.
export interface EmailRequestCodeResponse {
  ok: boolean;
  expiresInMinutes: number;
}

// Backend error envelope for /auth/email/*. `error` carries the display message.
export interface EmailErrorBody {
  error: string;
  reason?: string;
  retryAfterSeconds?: number; // present on 429 (cooldown)
  remainingAttempts?: number; // present on code-verify failures
}
