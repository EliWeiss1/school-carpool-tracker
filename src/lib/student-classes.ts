/**
 * Turns a PostgREST student row with its embedded class links into the flat
 * `StudentWithClasses` the rest of the app uses.
 *
 * A student's classes live in the `student_classes` join table, so any browser
 * query that needs them embeds the links and runs the row through
 * `withClassNames`. This mirrors `supabase/functions/_shared/class-embed.ts`
 * (the Edge Function side) so a student has the same `class_groups` whether it
 * arrived from an anon read or from an Edge Function.
 *
 * Pure and dependency-free so it is unit-tested without a database.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Student, StudentWithClasses } from "@/types/db";

/** The select string that fetches a student with the embed `withClassNames` reads. */
export const STUDENT_WITH_CLASSES_SELECT =
  "*, student_classes(class_groups(name, sort_order))";

/** What the embed in `STUDENT_WITH_CLASSES_SELECT` looks like on the wire. */
export type StudentClassesEmbed = {
  student_classes: {
    /** Null when the class row could not be read (e.g. removed mid-request). */
    class_groups: { name: string; sort_order: number } | null;
  }[];
};

/**
 * Class names in class `sort_order`, ties broken by name, with the embed
 * removed so it never leaks into state or comparisons. A row fetched without
 * the embed (or a realtime payload, which carries none) yields `[]`.
 */
export function withClassNames(
  row: Student & Partial<StudentClassesEmbed>,
): StudentWithClasses {
  const { student_classes, ...student } = row;

  const classes = (student_classes ?? []).flatMap((link) =>
    link.class_groups ? [link.class_groups] : [],
  );
  classes.sort(
    (a, b) =>
      a.sort_order - b.sort_order ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );

  return { ...student, class_groups: classes.map((group) => group.name) };
}

/**
 * Reads every student with their classes, through whatever client the screen
 * was given. `schoolId` null is the legacy route and the query is exactly the
 * unfiltered one it always was; a school id adds an explicit filter so a user
 * who belongs to two schools (RLS shows them both) sees only this one.
 */
export async function fetchStudentsWithClasses(
  client: SupabaseClient<Database>,
  schoolId: string | null,
): Promise<{ data: StudentWithClasses[]; error: { message: string } | null }> {
  const base = client.from("students").select(STUDENT_WITH_CLASSES_SELECT);
  const { data, error } = await (
    schoolId === null ? base : base.eq("school_id", schoolId)
  ).returns<(Student & StudentClassesEmbed)[]>();
  return { data: (data ?? []).map(withClassNames), error };
}
