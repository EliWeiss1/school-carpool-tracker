"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { PadStudent } from "@/lib/class-roster";
import {
  STUDENT_WITH_CLASSES_SELECT,
  type StudentClassesEmbed,
  withClassNames,
} from "@/lib/student-classes";
import { getBrowserClient } from "@/lib/supabase/browser";
import type { Student } from "@/types/db";

export interface UseClassRoster {
  roster: PadStudent[];
  /** True until the first fetch settles, success or not. */
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * The roster the class drawer lists and the search box suggests from, read
 * straight from Postgres with the anon key -- `students` is publicly readable
 * (it is what /display shows), so this
 * needs no PIN and no Edge Function. Only the write goes through the PIN.
 *
 * Fetched once up front so the drawer opens instantly, then re-fetched by the
 * caller after every announce or undo so a name flips to "arrived" without a
 * reload. A failed refresh keeps the last good roster rather than blanking a
 * list someone is in the middle of tapping.
 */
export function useClassRoster(): UseClassRoster {
  const [roster, setRoster] = useState<PadStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const { data, error: queryError } = await getBrowserClient()
        .from("students")
        .select(STUDENT_WITH_CLASSES_SELECT)
        .returns<(Student & StudentClassesEmbed)[]>();
      if (!mounted.current) return;
      if (queryError) throw new Error(queryError.message);
      setRoster((data ?? []).map(withClassNames));
      setError(null);
    } catch (caught: unknown) {
      if (!mounted.current) return;
      setError(
        caught instanceof Error
          ? `Could not load the class lists: ${caught.message}`
          : "Could not load the class lists.",
      );
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  return { roster, loading, error, refresh };
}
