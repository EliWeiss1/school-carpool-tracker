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

/** The dropdown's value for a scope: a class name, or "" for "All classes". */
export function classPickOf(scope: MemberScope): string {
  return typeof scope === "string" ? "" : scope.classGroup;
}

/** The scope a dropdown pick stands for; "" (All classes) lifts the class filter. */
export function scopeForClassPick(pick: string): MemberScope {
  return pick === "" ? "all" : { classGroup: pick };
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

/**
 * How many of `ids` would be left with no class at all if they left
 * `className`: members whose only class is that one. Students who are not in
 * it are unaffected, so they are not counted. Used by the sheet footer and the
 * roster's bulk Remove confirmation, so neither strands anyone silently.
 */
export function countLeftWithNoClass(
  students: readonly RosterStudent[],
  ids: Iterable<string>,
  className: string,
): number {
  const wanted = new Set(ids);
  return students.filter(
    (s) =>
      wanted.has(s.id) &&
      s.class_groups.includes(className) &&
      s.class_groups.every((name) => name === className),
  ).length;
}

/**
 * The sticky footer's summary of what Save will do. `stranded` is how many of
 * the removals leave a student in no class; shown only when above zero.
 */
export function describeDiff(diff: MembershipDiff, stranded = 0): string {
  const parts: string[] = [];
  if (diff.add.length > 0) parts.push(`add ${diff.add.length}`);
  if (diff.remove.length > 0) parts.push(`remove ${diff.remove.length}`);
  if (parts.length === 0) return "No changes";
  const text = parts.join(", ");
  const summary = text.charAt(0).toUpperCase() + text.slice(1);
  return stranded > 0 ? `${summary} · ${stranded} will have no class` : summary;
}

/**
 * The line under a student in the membership sheet. For a student who is (or
 * is being made) a member it lists their other classes ("Also in"); for one
 * who is not in this class it lists the classes they are in ("In"), since
 * "Also in" would wrongly imply they are in this one.
 */
export function studentClassesLine(
  classes: readonly string[],
  className: string,
  inThisClass: boolean,
): string {
  const others = classes.filter((name) => name !== className);
  if (others.length > 0) {
    return `${inThisClass ? "Also in" : "In"} ${others.join(", ")}`;
  }
  return classes.includes(className) ? "No other class" : "No class yet";
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
