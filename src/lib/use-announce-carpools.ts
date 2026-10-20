"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { adminApi } from "@/lib/admin-api";
import { ApiError, type Credentials } from "@/lib/api";
import type { TypeaheadCarpool } from "@/lib/typeahead";

/** After a failed load, how long before the next keystroke may try again. */
const RETRY_AFTER_MS = 30_000;

export interface UseAnnounceCarpools {
  carpools: TypeaheadCarpool[];
  /** Starts the one load, if it has not run yet. Cheap to call on every keystroke. */
  ensureLoaded: () => void;
}

/**
 * Carpool names for the search box's suggestions.
 *
 * `carpools` has no public read policy on purpose (see CLAUDE.md, Carpools), so
 * unlike the student roster this cannot come from the anon key: it goes
 * through the PIN-gated `roster-list`. Loaded lazily on the first keystroke
 * rather than on mount, so a shift spent only on the mic never makes the call,
 * and once per page after that -- carpools change in /admin, not mid-pickup.
 *
 * A failure is quiet: suggestions still find every student by name, a carpool
 * member is just offered alone instead of as their carpool. A wrong PIN is not
 * quiet -- `onPinRejected` sends the caller back through the gate, the same as
 * any other /announce call.
 */
export function useAnnounceCarpools(
  credentials: () => Credentials | null,
  onPinRejected: () => void,
): UseAnnounceCarpools {
  const [carpools, setCarpools] = useState<TypeaheadCarpool[]>([]);
  const stateRef = useRef<"idle" | "loading" | "loaded">("idle");
  const failedAtRef = useRef<number | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const ensureLoaded = useCallback(() => {
    if (stateRef.current !== "idle") return;
    if (
      failedAtRef.current !== null &&
      Date.now() - failedAtRef.current < RETRY_AFTER_MS
    )
      return;
    const creds = credentials();
    if (!creds) return;

    stateRef.current = "loading";
    adminApi
      .listRoster(creds)
      .then((response) => {
        stateRef.current = "loaded";
        if (!mounted.current) return;
        setCarpools(
          response.carpools.map(({ id, name, aliases }) => ({
            id,
            name,
            aliases: aliases ?? [],
          })),
        );
      })
      .catch((error: unknown) => {
        stateRef.current = "idle";
        failedAtRef.current = Date.now();
        if (mounted.current && error instanceof ApiError && error.needsPin) {
          onPinRejected();
        }
      });
  }, [credentials, onPinRejected]);

  return { carpools, ensureLoaded };
}
