/**
 * Holds the current Supabase access token so a request can read it
 * synchronously.
 *
 * `supabase.auth.getSession()` is async, but a screen's `credentials()` is not
 * (it is called at the moment of a request and must answer at once). So this
 * keeps the latest token, fed from `onAuthStateChange`, and reports null once
 * the token has expired rather than handing out one the server will refuse.
 * Pure, with an injectable clock, like `pin-session.ts`.
 */

/** The fields of a Supabase session this store reads. */
export interface TokenSession {
  access_token: string;
  /** Unix seconds, as Supabase reports it. */
  expires_at?: number | null;
}

/** The auth events that can carry a session. Others are ignored. */
export type TokenEvent =
  | "INITIAL_SESSION"
  | "SIGNED_IN"
  | "TOKEN_REFRESHED"
  | "SIGNED_OUT"
  | (string & {});

export interface TokenStore {
  /** The token, or null when absent or expired. */
  current(): string | null;
  /** True when a token exists but expires within `windowMs` (or already has). */
  expiresWithin(windowMs: number): boolean;
  /** Feed an `onAuthStateChange` event (or an initial `getSession()` result). */
  apply(event: TokenEvent, session: TokenSession | null): void;
  subscribe(listener: () => void): () => void;
}

export function createTokenStore(
  options: { now?: () => number; initial?: TokenSession | null } = {},
): TokenStore {
  const now = options.now ?? Date.now;
  let token: string | null = null;
  /** Epoch ms, or null when the session did not say. */
  let expiresAtMs: number | null = null;
  const listeners = new Set<() => void>();

  function set(session: TokenSession | null): void {
    token = session?.access_token ?? null;
    expiresAtMs =
      session && typeof session.expires_at === "number"
        ? session.expires_at * 1000
        : null;
  }

  function expired(): boolean {
    return expiresAtMs !== null && now() >= expiresAtMs;
  }

  set(options.initial ?? null);

  return {
    current() {
      return token !== null && !expired() ? token : null;
    },

    expiresWithin(windowMs) {
      if (token === null) return false;
      return expiresAtMs !== null && now() >= expiresAtMs - windowMs;
    },

    apply(event, session) {
      if (event === "SIGNED_OUT") {
        set(null);
      } else if (
        event === "INITIAL_SESSION" ||
        event === "SIGNED_IN" ||
        event === "TOKEN_REFRESHED"
      ) {
        set(session);
      } else {
        return; // USER_UPDATED, PASSWORD_RECOVERY and the like change nothing here.
      }
      for (const listener of listeners) listener();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
