/**
 * Whether a previously-minted Deepgram token (and its keyterm list) is still
 * good to reuse.
 *
 * A fresh token is requested on the *first* press of the push-to-talk button,
 * not on every press: CLAUDE.md says the browser "should re-mint before this
 * runs out", not "before every use", and the whole point of caching is that a
 * network round trip to `deepgram-token` before the mic can open is exactly
 * the latency a press-and-hold control cannot afford. Plain functions with an
 * injected `now`, same reasoning as `announce-undo.ts`.
 */

/** Re-mint this long before the real deadline, not exactly at it. */
export const REFRESH_BUFFER_MS = 15_000;

/** Absolute expiry, in ms since epoch, from a `deepgram-token` response. */
export function expiresAt(mintedAt: number, expiresInSeconds: number): number {
  const ttlMs =
    Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
      ? expiresInSeconds * 1000
      : 0;
  return mintedAt + ttlMs;
}

/** True when a cached token can be reused instead of re-minting. */
export function isFresh(expiresAtMs: number | null, now: number): boolean {
  if (expiresAtMs === null) return false;
  return now < expiresAtMs - REFRESH_BUFFER_MS;
}
