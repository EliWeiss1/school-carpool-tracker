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

import type { Student, StudentWithClasses } from "@/types/db";

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
