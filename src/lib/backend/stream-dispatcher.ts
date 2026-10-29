import { EnvHttpProxyAgent } from 'undici';

/**
 * Dispatcher for long-lived backend SSE: no header/body read timeouts, so an idle orchestration stream (gaps
 * between agent events) isn't killed with UND_ERR_BODY_TIMEOUT. The inline `bodyTimeout` RequestInit option is
 * ignored by fetch — it must be set on the dispatcher.
 *
 * It must also honour HTTP(S)_PROXY / NO_PROXY. A custom dispatcher replaces the one Node's fetch would pick from
 * NODE_USE_ENV_PROXY, so a plain `Agent` connects directly — and on Ainize, where egress only leaves through the
 * sandbox proxy, every stream then died with UND_ERR_CONNECT_TIMEOUT while ordinary fetches (sending the message)
 * worked: the thread appeared in AIN Teams and the chat box stayed empty (2026-10-29). Without proxy variables
 * (Vercel) this connects directly, as before.
 */
export function createStreamDispatcher(proxy: { httpProxy?: string; httpsProxy?: string; noProxy?: string } = {}) {
  return new EnvHttpProxyAgent({ headersTimeout: 0, bodyTimeout: 0, ...proxy });
}
