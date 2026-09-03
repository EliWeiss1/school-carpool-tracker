/**
 * The staff PIN, held in memory for the life of the tab and nowhere else.
 *
 * CLAUDE.md is unambiguous about this: never `localStorage`, never a cookie,
 * never sent anywhere but the Edge Function. A tablet propped on a windowsill
 * by the pickup lane is a shared device, and a PIN that survives a page close is
 * a PIN that survives the wrong person picking the tablet up.
 *
 * The store is deliberately plain — no React — so its rules are testable in
 * Node. `use-pin-session.ts` is the thin hook on top.
 */

/** What React is allowed to see. The PIN itself is never in here. */
export interface PinSessionSnapshot {
  unlocked: boolean;
}

export type PinSessionListener = () => void;

export interface PinSession {
  getSnapshot(): PinSessionSnapshot;
  /** Always locked: the server has no device session to speak of. */
  getServerSnapshot(): PinSessionSnapshot;
  subscribe(listener: PinSessionListener): () => void;
  unlock(pin: string): void;
  lock(): void;
  /**
   * The PIN, for the one job it has: going into a request body. Null when
   * locked, so a caller that forgot to check gets a type error rather than
   * sending `undefined` and reading it back as a 401.
   */
  requirePin(): string | null;
}

const LOCKED: PinSessionSnapshot = Object.freeze({ unlocked: false });
const UNLOCKED: PinSessionSnapshot = Object.freeze({ unlocked: true });

export function createPinSession(): PinSession {
  // A closure variable, not a module field: it cannot be reached from a
  // devtools console, a serialized state tree, or an error report.
  let pin: string | null = null;
  const listeners = new Set<PinSessionListener>();

  function emit(): void {
    for (const listener of listeners) listener();
  }

  return {
    // The two frozen constants are the whole reason this is safe to pass to
    // useSyncExternalStore: getSnapshot must be referentially stable between
    // changes or React re-renders until the stack gives out.
    getSnapshot: () => (pin === null ? LOCKED : UNLOCKED),
    getServerSnapshot: () => LOCKED,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    unlock(candidate: string) {
      const trimmed = candidate.trim();
      if (trimmed === "") {
        throw new Error("Enter the staff PIN.");
      }
      pin = trimmed;
      emit();
    },

    lock() {
      if (pin === null) return;
      pin = null;
      emit();
    },

    requirePin: () => pin,
  };
}

/**
 * The one session the app shares. Module scope means it lives exactly as long
 * as the tab does, which is precisely the lifetime CLAUDE.md asks for.
 */
export const pinSession: PinSession = createPinSession();
