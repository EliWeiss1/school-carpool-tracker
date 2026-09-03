/**
 * Sound for /display: an unlock-aware player, plus a coalescer that turns a
 * burst of near-simultaneous arrivals into one pleasant chime instead of five
 * overlapping ones.
 *
 * Split in two on purpose:
 *
 * - `createChimeCoalescer` is pure -- an injectable clock, no browser APIs --
 *   which is what makes "several children arrive in the same second" a case
 *   Vitest can actually drive with synthetic timestamps.
 * - `createChimePlayer` wraps `HTMLAudioElement`, which does not exist under
 *   Vitest's `node` test environment. It degrades to a documented no-op there
 *   (`play()` resolves `false`) instead of throwing at import time, so a
 *   component can import both from one module without the test file needing
 *   a DOM.
 *
 * The chime trigger and the CSS flash animation are two independent
 * consumers of the same `arrivals` list from `realtime-reconcile.ts` -- the
 * chime is never wired to an `animationend` event, so `prefers-reduced-motion`
 * (which the global guard in `globals.css` collapses to a near-zero duration)
 * cannot silence it as a side effect.
 */

export interface ChimeCoalescerOptions {
  /** Minimum gap, in ms, between two audible chimes. */
  windowMs: number;
  /** Injectable clock so tests never sleep. */
  now?: () => number;
}

export interface ChimeCoalescer {
  /**
   * Call once per arrival. Returns `true` exactly when the caller should
   * actually play the sound -- every call inside `windowMs` of the last
   * accepted one collapses to `false`.
   */
  notify(): boolean;
}

export function createChimeCoalescer(
  options: ChimeCoalescerOptions,
): ChimeCoalescer {
  const now = options.now ?? (() => Date.now());
  let lastPlayedAt: number | null = null;

  return {
    notify(): boolean {
      const at = now();
      if (lastPlayedAt === null || at - lastPlayedAt >= options.windowMs) {
        lastPlayedAt = at;
        return true;
      }
      return false;
    },
  };
}

export interface ChimePlayer {
  /**
   * Resolves `true` when the chime actually played, `false` when the browser
   * blocked it (no user gesture yet) or when there is no browser at all.
   * Never rejects -- a blocked chime is an expected outcome, not a fault.
   */
  play(): Promise<boolean>;
}

/** `src` is a public path, e.g. `/chime.wav` -- see `scripts/generate-chime.mjs`. */
export function createChimePlayer(src: string): ChimePlayer {
  let audio: HTMLAudioElement | null = null;

  function getAudio(): HTMLAudioElement | null {
    if (typeof window === "undefined" || typeof Audio === "undefined") {
      return null;
    }
    audio ??= new Audio(src);
    return audio;
  }

  return {
    async play(): Promise<boolean> {
      const element = getAudio();
      if (!element) return false;
      try {
        element.currentTime = 0;
        await element.play();
        return true;
      } catch {
        // NotAllowedError (no user gesture yet) and every other playback
        // failure are the same thing to a caller: the board stays silent and
        // fully functional, and it is on the caller to offer "Enable sound".
        return false;
      }
    },
  };
}
