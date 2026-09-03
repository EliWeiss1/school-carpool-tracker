"use client";

/**
 * React's view of the device PIN session. All of the rules live in
 * `pin-session.ts`; this is only the subscription.
 */

import { useCallback, useSyncExternalStore } from "react";

import { deviceId } from "@/lib/device-id";
import { pinSession } from "@/lib/pin-session";

export interface UsePinSession {
  /** True once a PIN has been entered on this device this session. */
  unlocked: boolean;
  /** The rate-limit bucket for this tab. Safe to render; not a secret. */
  deviceId: string;
  unlock(pin: string): void;
  lock(): void;
  /**
   * The credentials an api.ts call needs, or null when locked. Call this at the
   * moment of the request — never hold the result in state, or the PIN ends up
   * in a React tree that could be serialized.
   */
  credentials(): { pin: string; deviceId: string } | null;
}

export function usePinSession(): UsePinSession {
  const snapshot = useSyncExternalStore(
    pinSession.subscribe,
    pinSession.getSnapshot,
    pinSession.getServerSnapshot,
  );

  const credentials = useCallback(() => {
    const pin = pinSession.requirePin();
    return pin === null ? null : { pin, deviceId: deviceId() };
  }, []);

  const unlock = useCallback((pin: string) => pinSession.unlock(pin), []);
  const lock = useCallback(() => pinSession.lock(), []);

  return {
    unlocked: snapshot.unlocked,
    deviceId: deviceId(),
    unlock,
    lock,
    credentials,
  };
}
