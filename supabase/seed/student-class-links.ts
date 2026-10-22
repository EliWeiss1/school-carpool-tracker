/**
 * Turns the sample roster into `student_classes` rows.
 *
 * A student's classes live in the `student_classes` join table, so seeding is
 * two steps: insert the students, then link each one to its classes by name.
 * The linking is pure (class name -> id lookup in, rows out) so it is
 * unit-tested here and `scripts/seed.ts` only does the database calls.
 */

import type { SampleStudent } from "./roster";

/** A seeded student paired with the id the database gave them. */
export interface StudentWithId {
  studentId: string;
  class_groups: string[];
}

/** A row for `public.student_classes`. */
export interface StudentClassLink {
  student_id: string;
  class_group_id: string;
}

/**
 * Thrown when the roster names a class the database does not have. Carries
 * every missing name, so one run tells you the whole list rather than making
 * you fix them one at a time.
 */
export class UnknownClassError extends Error {
  constructor(readonly missing: string[]) {
    super(
      `The sample roster uses ${missing.length === 1 ? "a class" : "classes"} ` +
        `the database does not have: ${missing.join(", ")}. ` +
        "Classes come from the class_groups table (seeded by migration " +
        "20260916010000_class_groups.sql, and editable on /admin); " +
        "create them there or fix supabase/seed/roster.ts.",
    );
    this.name = "UnknownClassError";
  }
}

/**
 * One link per (student, class). Class names match case-insensitively, the
 * same way `class_groups`' unique index on `lower(name)` treats them, and a
 * class listed twice for one student collapses to a single link (the join
 * table's primary key would reject the duplicate).
 *
 * @param classIdByName class name -> `class_groups.id`
 * @throws UnknownClassError if any class name has no id
 */
export function buildStudentClassLinks(
  students: StudentWithId[],
  classIdByName: ReadonlyMap<string, string>,
): StudentClassLink[] {
  const idByLowerName = new Map<string, string>();
  for (const [name, id] of classIdByName) {
    idByLowerName.set(name.toLowerCase(), id);
  }

  const missing: string[] = [];
  const links: StudentClassLink[] = [];

  for (const student of students) {
    const seen = new Set<string>();
    for (const name of student.class_groups) {
      const classId = idByLowerName.get(name.toLowerCase());
      if (!classId) {
        if (!missing.includes(name)) missing.push(name);
        continue;
      }
      if (seen.has(classId)) continue;
      seen.add(classId);
      links.push({ student_id: student.studentId, class_group_id: classId });
    }
  }

  if (missing.length > 0) throw new UnknownClassError(missing);
  return links;
}

const fullName = (s: { first_name: string; last_name: string }) =>
  `${s.first_name} ${s.last_name}`;

/**
 * Pairs each roster entry with the id the database assigned it. Matched on
 * full name (unique across the sample roster, which a test asserts) rather
 * than on row order, because an insert's returned order is not a contract.
 *
 * @throws Error if a roster entry has no matching inserted row
 */
export function attachInsertedIds(
  roster: Pick<SampleStudent, "first_name" | "last_name" | "class_groups">[],
  inserted: { id: string; first_name: string; last_name: string }[],
): StudentWithId[] {
  const idByName = new Map(inserted.map((row) => [fullName(row), row.id]));

  return roster.map((entry) => {
    const studentId = idByName.get(fullName(entry));
    if (!studentId) {
      throw new Error(
        `${fullName(entry)} was not returned by the student insert, ` +
          "so their classes cannot be linked.",
      );
    }
    return { studentId, class_groups: entry.class_groups };
  });
}
