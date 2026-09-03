/**
 * The ~2-minute undo window after a confirm.
 *
 * CLAUDE.md is explicit that this is a client-side affordance only — the
 * server accepts `set-status` with `status: "waiting"` from any PIN holder at
 * any time and does not enforce a window (see the phase 3 judgment calls). So
 * the whole job of this module is deciding what a countdown badge should say,
 * and it is deliberately plain functions with an injected `now`: no `Date.now()`
 * inside, no timers, no React — which is what makes it testable in Node with no
 * fake-timer gymnastics. `announce-screen.tsx` is the thing that ticks a clock
 * and re-renders; this only answers "how much time is left".
 */

/** ~2 minutes, per the phase 4 checklist. */
export const UNDO_WINDOW_MS = 2 * 60 * 1000;

export interface UndoableConfirmation {
  studentId: string;
  /** "First Last", for the banner — never re-derived from a stale roster row. */
  displayName: string;
  /** `Date.now()` at the moment `set-status` reported `changed: true`. */
  confirmedAt: number;
}

/** Milliseconds left in the window. Clamped to zero, never negative. */
export function remainingMs(
  confirmation: UndoableConfirmation,
  now: number,
): number {
  return Math.max(0, confirmation.confirmedAt + UNDO_WINDOW_MS - now);
}

/** Whether the undo button should still be shown at all. */
export function canUndo(confirmation: UndoableConfirmation, now: number): boolean {
  return remainingMs(confirmation, now) > 0;
}

/**
 * "m:ss" for the badge. Rounds up (`Math.ceil`) rather than down: a countdown
 * that floors would show "0:00" for up to a second while `canUndo` is still
 * true, which reads as broken on a screen someone is staring at with a thumb
 * over the button.
 */
export function formatRemaining(ms: number): string {
  const totalSeconds = Math.ceil(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
