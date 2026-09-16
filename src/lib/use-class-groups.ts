"use client";

import { useCallback, useEffect, useState } from "react";

import { type ClassGroup, fetchClassGroups } from "@/lib/class-groups";
import { getBrowserClient } from "@/lib/supabase/browser";

export interface UseClassGroups {
  classGroups: ClassGroup[];
  /** Names only, in display order -- what a picker actually renders. */
  names: string[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * The one place every screen's class picker gets its list from. A fetch
 * failure (no Supabase project configured, offline) surfaces as `error` but
 * never throws -- a picker with an empty list degrades to free typing on the
 * class field elsewhere, not a broken page.
 */
export function useClassGroups(): UseClassGroups {
  const [classGroups, setClassGroups] = useState<ClassGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const groups = await fetchClassGroups(getBrowserClient());
      setClassGroups(groups);
      setError(null);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not load the class list.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    classGroups,
    names: classGroups.map((group) => group.name),
    loading,
    error,
    refresh,
  };
}
