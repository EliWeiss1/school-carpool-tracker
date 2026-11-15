"use client";

/**
 * Binds a Supabase client's session to the `StaffSession` a screen reads.
 * The token rules live in `session-token.ts`; the access decisions in
 * `school-access.ts`. This is only the wiring.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useRef, useState } from "react";

import { deviceId } from "@/lib/device-id";
import { officeLoginHref } from "@/lib/school-access";
import type { StaffSession } from "@/lib/screen-access";
import { createTokenStore, type TokenSession } from "@/lib/session-token";

/** Ask for a fresh token this long before the current one runs out. */
const REFRESH_WINDOW_MS = 60_000;

export interface UseSchoolSessionOptions {
  client: SupabaseClient;
  kind: "office" | "device";
  schoolId: string;
  /**
   * The session the gate already read. Seeding the store with it matters:
   * a child's effects run before this hook's, so without it the first request
   * a screen makes on mount would find no token.
   */
  initialSession: TokenSession | null;
  /** Device only: re-check access (disconnected, or a transient 401). */
  onRecheck: () => void;
}

export function useSchoolSession({
  client,
  kind,
  schoolId,
  initialSession,
  onRecheck,
}: UseSchoolSessionOptions): StaffSession {
  const [store] = useState(() => createTokenStore({ initial: initialSession }));
  const refreshing = useRef(false);
  const recheckRef = useRef(onRecheck);
  recheckRef.current = onRecheck;

  useEffect(() => {
    const { data } = client.auth.onAuthStateChange((event, session) => {
      store.apply(event, session);
    });
    return () => data.subscription.unsubscribe();
  }, [client, store]);

  return useMemo<StaffSession>(
    () => ({
      deviceId: deviceId(),

      credentials() {
        // Near expiry: refresh in the background so the next call is fresh.
        // getSession() refreshes an expiring token; the auth event feeds the
        // store, and applying the result too covers a missed event.
        if (store.expiresWithin(REFRESH_WINDOW_MS) && !refreshing.current) {
          refreshing.current = true;
          void client.auth
            .getSession()
            .then(({ data }) => {
              if (data.session) store.apply("TOKEN_REFRESHED", data.session);
            })
            .catch(() => undefined)
            .finally(() => {
              refreshing.current = false;
            });
        }

        const accessToken = store.current();
        return accessToken === null
          ? null
          : { schoolId, accessToken, deviceId: deviceId() };
      },

      lock() {
        if (kind === "device") {
          // A device never forgets itself. The gate re-reads its access, so a
          // device the office disconnected lands on the code prompt and a
          // transient 401 simply resolves again.
          recheckRef.current();
          return;
        }
        const here = window.location.pathname + window.location.search;
        void client.auth
          .signOut()
          .catch(() => undefined)
          .finally(() => window.location.assign(officeLoginHref(here)));
      },

      exitLabel: kind === "office" ? "Sign out" : null,
    }),
    [client, kind, schoolId, store],
  );
}
