/**
 * Per-device fixed-window rate limiting.
 *
 * The threat here is not an attacker, it is a phone in a coat pocket with the
 * announce page open, or a stuck button sending the same child through fifty
 * times. So: cheap, in-memory, and per Edge Function isolate. Supabase may run
 * several isolates, which makes the effective limit a multiple of this one --
 * acceptable for spam control, and the reason this is not the security boundary.
 * The PIN check is.
 */

export interface RateLimitResult {
  allowed: boolean;
  /** Requests left in the current window, after counting this one. */
  remaining: number;
  /** Whole seconds until the window resets. 0 while the caller is under limit. */
  retryAfterSeconds: number;
}

export interface RateLimiterOptions {
  /** Requests allowed per window. */
  limit: number;
  windowMs: number;
  /**
   * Most keys tracked at once. Keys come from the network, so without a ceiling
   * a flood of distinct ones grows the map and makes every prune walk longer.
   * Oldest windows are evicted first.
   */
  maxKeys?: number;
  /** Injectable clock so tests never sleep. */
  now?: () => number;
}

export interface RateLimiter {
  check(key: string): RateLimitResult;
  /** What `check` would say, without spending any of the key's budget. */
  peek(key: string): RateLimitResult;
  /** Number of devices currently tracked. Operational readout. */
  size(): number;
}

interface Window {
  count: number;
  /** When this window opened. */
  startedAt: number;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { limit, windowMs } = options;
  const maxKeys = options.maxKeys ?? 10_000;
  const now = options.now ?? (() => Date.now());
  const windows = new Map<string, Window>();

  /** Drop expired windows so a long-lived isolate does not accumulate devices. */
  function prune(at: number): void {
    for (const [key, window] of windows) {
      if (at - window.startedAt >= windowMs) windows.delete(key);
    }

    // Map preserves insertion order, so the front is the oldest window. Evicting
    // it only ever forgives a caller -- it can never block one.
    while (windows.size > maxKeys) {
      const oldest = windows.keys().next();
      if (oldest.done) break;
      windows.delete(oldest.value);
    }
  }

  return {
    check(key: string): RateLimitResult {
      const at = now();
      prune(at);

      const window = windows.get(key) ?? { count: 0, startedAt: at };
      window.count++;
      windows.set(key, window);

      const allowed = window.count <= limit;
      const elapsed = at - window.startedAt;

      return {
        allowed,
        remaining: Math.max(limit - window.count, 0),
        retryAfterSeconds: allowed ? 0 : Math.ceil((windowMs - elapsed) / 1000),
      };
    },

    peek(key: string): RateLimitResult {
      const at = now();
      const window = windows.get(key);
      const elapsed = window ? at - window.startedAt : 0;
      const spent = !window || elapsed >= windowMs ? 0 : window.count;
      const allowed = spent < limit;

      return {
        allowed,
        remaining: Math.max(limit - spent, 0),
        retryAfterSeconds: allowed ? 0 : Math.ceil((windowMs - elapsed) / 1000),
      };
    },

    size(): number {
      return windows.size;
    },
  };
}
