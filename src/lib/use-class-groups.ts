"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { type ClassGroup, fetchClassGroups } from "@/lib/class-groups";
import { useSchoolScope } from "@/lib/screen-access";

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
  const scope = useSchoolScope();
  const schoolId = scope.school?.id ?? null;
  // Held in a ref so a provider that rebuilds its scope object each render
  // cannot retrigger the fetch; only a change of school does.
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [classGroups, setClassGroups] = useState<ClassGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const groups = await fetchClassGroups(
        scopeRef.current.supabase(),
        schoolId,
      );
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
  }, [schoolId]);

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
