"use client";

/**
 * How a screen learns who it is acting as and which school it is showing.
 *
 * The three screens (/announce, /display, /admin) are mounted two ways during
 * the multi-school rollout:
 *
 * - **Legacy routes** (`/announce`, `/display`, `/admin`): one school, the
 *   shared staff PIN, the public key for reads. No provider is mounted; the
 *   hooks below fall back to exactly what those screens always did.
 * - **School routes** (`/s/<school>/...`): a provider is mounted by the gate
 *   that let the visitor in, carrying either the office's signed-in session or
 *   a paired device's session, and the school it belongs to.
 *
 * A screen never asks which of these it is. It calls `useStaffSession()` for
 * the credentials an Edge Function call needs and `useSchoolScope()` for where
 * to read from, and behaves the same either way. That is the whole point of
 * this file: the screens stay one implementation, and the legacy fallback can
 * be deleted at cutover without touching them.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createContext, type ReactNode, useContext, useMemo } from "react";

import type { Credentials } from "@/lib/api";
import { getBrowserClient } from "@/lib/supabase/browser";
import { usePinSession } from "@/lib/use-pin-session";
import type { Database } from "@/types/db";

/** Who the screen is acting as, for calls that change something. */
export interface StaffSession {
  /** The rate-limit bucket for this tab. Safe to render; not a secret. */
  deviceId: string;
  /**
   * The credentials an Edge Function call needs, or null when there are none
   * (locked, signed out, disconnected). Call this at the moment of the request
   * and never hold the result in state: it carries a PIN or an access token.
   */
  credentials(): Credentials | null;
  /**
   * Give up these credentials. Called when the person chooses to leave, and by
   * a screen when the server answers that they no longer work (401 or 403).
   * What happens next is the gate's business: the PIN prompt, the sign-in
   * page, or the school's code prompt.
   */
  lock(): void;
  /**
   * The words for the header control that calls `lock()`, or null when the
   * screen should offer none. A paired phone or wall board stays connected
   * until the office disconnects it, so it gets no such control.
   */
  exitLabel: string | null;
}

export interface SchoolSummary {
  id: string;
  name: string;
  slug: string;
}

/** Which school a screen shows, and what it reads through. */
export interface SchoolScope {
  /** Null on the legacy single-school routes. */
  school: SchoolSummary | null;
  /**
   * The client for reads and the live subscription: the public key (legacy),
   * the office session, or the device session. A function, not a value, so
   * nothing is constructed during server rendering.
   */
  supabase(): SupabaseClient<Database>;
  /**
   * The key for a per-browser preference (a remembered class filter, say).
   * Prefixed per school so two schools opened on one device never share one.
   */
  storageKey(name: string): string;
}

export interface ScreenAccess {
  session: StaffSession;
  scope: SchoolScope;
}

const ScreenAccessContext = createContext<ScreenAccess | null>(null);

/** Mounted by a school route's gate once it knows who the visitor is. */
export function ScreenAccessProvider({
  value,
  children,
}: {
  value: ScreenAccess;
  children: ReactNode;
}) {
  return (
    <ScreenAccessContext.Provider value={value}>
      {children}
    </ScreenAccessContext.Provider>
  );
}

/** The per-school key for a preference: `<name>` alone on the legacy routes. */
export function scopedStorageKey(
  school: SchoolSummary | null,
  name: string,
): string {
  return school === null ? name : `${name}:${school.id}`;
}

/** The legacy routes' scope: one school, the public key, unprefixed keys. */
export const legacyScope: SchoolScope = {
  school: null,
  supabase: getBrowserClient,
  storageKey: (name) => scopedStorageKey(null, name),
};

export function useStaffSession(): StaffSession {
  const provided = useContext(ScreenAccessContext);
  // Called unconditionally to keep the hook order fixed. On a school route it
  // is an idle subscription to a PIN store nothing ever unlocks.
  const pin = usePinSession();
  const legacy = useMemo<StaffSession>(
    () => ({
      deviceId: pin.deviceId,
      credentials: pin.credentials,
      lock: pin.lock,
      exitLabel: "Lock",
    }),
    [pin.deviceId, pin.credentials, pin.lock],
  );
  return provided?.session ?? legacy;
}

export function useSchoolScope(): SchoolScope {
  return useContext(ScreenAccessContext)?.scope ?? legacyScope;
}
