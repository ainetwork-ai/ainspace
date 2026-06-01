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
  refreshToken: string;
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
  refreshToken: string;
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
