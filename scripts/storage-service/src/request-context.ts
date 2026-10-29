import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The client of the command being served. A caller that gave up (Vercel aborts at 45 s) must not keep
 * its reads queued: on 2026-10-29 abandoned work filled all 256 slots and every new request got "busy".
 */
export const requestContext = new AsyncLocalStorage<{ signal: AbortSignal }>();
export const clientGone = () => requestContext.getStore()?.signal.aborted === true;
