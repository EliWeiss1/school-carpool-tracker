import type { ClassMembersInput, RosterStudent } from "@/lib/admin-api";

/**
 * Pure logic behind the class membership sheet (/admin > Classes > Students).
 * Kept out of the component so every rule -- what counts as "in" a class, what
 * saving will change, what the footer says -- is unit-tested without a DOM.
 *
 * Members are identified by student id. A student is "in" a class when their
 * `class_groups` (class NAMES) include it.
 */

export interface MembershipDiff {
  add: string[];
  remove: string[];
}

/** Which students the sheet shows. `{ classGroup }` = students in that other class. */
export type MemberScope = "all" | "in" | "out" | { classGroup: string };

export interface MemberFilter {
  text: string;
  scope: MemberScope;
  classId: string;
  className: string;
}

/** The ids of the students currently in `className`. */
export function memberIdsOf(
  students: readonly RosterStudent[],
  className: string,
): Set<string> {
  return new Set(
    students.filter((s) => s.class_groups.includes(className)).map((s) => s.id),
  );
}

/** Only what Save would change: ids newly ticked, and ids newly unticked. */
export function diffMembership(
  original: ReadonlySet<string>,
  chosen: ReadonlySet<string>,
): MembershipDiff {
  return {
    add: [...chosen].filter((id) => !original.has(id)),
    remove: [...original].filter((id) => !chosen.has(id)),
  };
}

/** Save is disabled until something actually changes. */
export function hasChanges(diff: MembershipDiff): boolean {
  return diff.add.length > 0 || diff.remove.length > 0;
}

function matchesText(student: RosterStudent, needle: string): boolean {
  if (needle === "") return true;
  const haystacks = [
    student.first_name,
    student.last_name,
    `${student.first_name} ${student.last_name}`,
    `${student.last_name} ${student.first_name}`,
    ...student.aliases,
  ];
  return haystacks.some((h) => h.toLowerCase().includes(needle));
}

/** Name/alias search narrowed by a scope chip. Keeps the input order. */
export function filterStudents(
  students: readonly RosterStudent[],
  q: MemberFilter,
): RosterStudent[] {
  const needle = q.text.trim().toLowerCase();
  return students.filter((student) => {
    if (!matchesText(student, needle)) return false;
    const isMember = student.class_groups.includes(q.className);
    if (q.scope === "all") return true;
    if (q.scope === "in") return isMember;
    if (q.scope === "out") return !isMember;
    return student.class_groups.includes(q.scope.classGroup);
  });
}

/** The sticky footer's summary of what Save will do. */
export function describeDiff(diff: MembershipDiff): string {
  const parts: string[] = [];
  if (diff.add.length > 0) parts.push(`add ${diff.add.length}`);
  if (diff.remove.length > 0) parts.push(`remove ${diff.remove.length}`);
  if (parts.length === 0) return "No changes";
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The request body for Save, naming only the sides that have ids. */
export function membersPayload(
  classId: string,
  diff: MembershipDiff,
): Pick<ClassMembersInput, "classId" | "addStudentIds" | "removeStudentIds"> {
  return {
    classId,
    ...(diff.add.length > 0 ? { addStudentIds: diff.add } : {}),
    ...(diff.remove.length > 0 ? { removeStudentIds: diff.remove } : {}),
  };
}

/**
 * The sheet edits a snapshot of the roster, so it must never open on a roster
 * that has not arrived yet: it would show zero members and a later load would
 * look like "remove everyone".
 */
export function canOpenMembersSheet(rosterLoaded: boolean): boolean {
  return rosterLoaded;
}

/** "18 students", or an em dash while the roster (and so the count) is unknown. */
export function memberCountLabel(
  count: number | undefined,
  rosterLoaded: boolean,
): string {
  if (!rosterLoaded) return "—";
  const n = count ?? 0;
  return `${n} student${n === 1 ? "" : "s"}`;
}
