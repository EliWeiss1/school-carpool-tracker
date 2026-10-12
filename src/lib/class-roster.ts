/**
 * The pure logic behind /announce's class rail and student drawer.
 *
 * Everything here is data in, data out -- no React, no network -- so the rules
 * that decide what a staff member sees and what gets sent are unit-tested
 * without rendering (see `class-roster.test.ts`), the same split
 * `announce-reducer.ts` and `display-sections.ts` use.
 */

import type { StudentStatus } from "@/types/db";

/** The few columns the drawer needs. Not the whole `Student` row on purpose. */
export interface PadStudent {
  id: string;
  first_name: string;
  last_name: string;
  class_group: string | null;
  status: StudentStatus;
}

/**
 * Selected student ids, grouped by the class they were picked from.
 *
 * Grouped (rather than one flat list) so that narrowing a class out of the
 * filter can drop exactly that class's picks. A flat list would leave ids
 * selected that no screen shows any more, and "Announce 3" would then quietly
 * announce someone the staff member cannot see.
 */
export type PadSelection = Record<string, string[]>;

/** Stable sort so a name never jumps position between renders. */
function byName(a: PadStudent, b: PadStudent): number {
  return (
    a.last_name.localeCompare(b.last_name, undefined, { sensitivity: "base" }) ||
    a.first_name.localeCompare(b.first_name, undefined, { sensitivity: "base" })
  );
}

/**
 * The classes the rail offers: the narrowed set, or every class when nothing
 * is narrowed. Always in the admin's display order, never click order, so the
 * rail does not reshuffle as chips are toggled. A narrowed name that is no
 * longer on the class list (an admin removed it) is dropped rather than shown.
 */
export function railClasses(
  allClasses: readonly string[],
  narrowedTo: readonly string[],
): string[] {
  if (narrowedTo.length === 0) return [...allClasses];
  const wanted = new Set(narrowedTo);
  return allClasses.filter((name) => wanted.has(name));
}

/** One class's students, A to Z by surname. */
export function studentsInClass(
  roster: readonly PadStudent[],
  classGroup: string,
): PadStudent[] {
  return roster.filter((s) => s.class_group === classGroup).sort(byName);
}

export interface ClassCounts {
  waiting: number;
  arrived: number;
}

export function countStatuses(students: readonly PadStudent[]): ClassCounts {
  let arrived = 0;
  for (const student of students) {
    if (student.status === "arrived") arrived += 1;
  }
  return { waiting: students.length - arrived, arrived };
}

/* -------------------------------------------------------------------------- */
/* Selection                                                                   */
/* -------------------------------------------------------------------------- */

export function toggleSelected(
  selection: PadSelection,
  classGroup: string,
  studentId: string,
): PadSelection {
  const current = selection[classGroup] ?? [];
  const next = current.includes(studentId)
    ? current.filter((id) => id !== studentId)
    : [...current, studentId];
  return withClass(selection, classGroup, next);
}

/** Every selected id, across classes, in the order the classes were first picked from. */
export function selectedIds(selection: PadSelection): string[] {
  return Object.values(selection).flat();
}

export function selectedCountIn(
  selection: PadSelection,
  classGroup: string,
): number {
  return selection[classGroup]?.length ?? 0;
}

/** Keeps picks only from the classes still on offer. */
export function pruneSelection(
  selection: PadSelection,
  keepClasses: readonly string[],
): PadSelection {
  const keep = new Set(keepClasses);
  const next: PadSelection = {};
  for (const [classGroup, ids] of Object.entries(selection)) {
    if (keep.has(classGroup)) next[classGroup] = ids;
  }
  return next;
}

/** Removes ids that have just been announced, wherever they were picked. */
export function removeIds(
  selection: PadSelection,
  ids: readonly string[],
): PadSelection {
  const gone = new Set(ids);
  const next: PadSelection = {};
  for (const [classGroup, picked] of Object.entries(selection)) {
    const remaining = picked.filter((id) => !gone.has(id));
    if (remaining.length > 0) next[classGroup] = remaining;
  }
  return next;
}

function withClass(
  selection: PadSelection,
  classGroup: string,
  ids: string[],
): PadSelection {
  const next = { ...selection };
  if (ids.length === 0) delete next[classGroup];
  else next[classGroup] = ids;
  return next;
}

/* -------------------------------------------------------------------------- */
/* Wording and cache keys                                                      */
/* -------------------------------------------------------------------------- */

/**
 * What the undo banner and status line call a batch. One student is named; a
 * batch is counted ("4 students"), because a list of names never fits beside
 * the Undo button on a phone, and who went is already visible in the drawer
 * the moment their row turns green.
 */
export function announceLabel(
  roster: readonly PadStudent[],
  ids: readonly string[],
): string {
  if (ids.length === 1) {
    const student = roster.find((s) => s.id === ids[0]);
    if (student) return `${student.first_name} ${student.last_name}`;
  }
  return ids.length === 1 ? "1 student" : `${ids.length} students`;
}

/**
 * Identity of a class scope for the Deepgram token cache. Order-insensitive,
 * so toggling K1 then 2nd and 2nd then K1 reuse the same token.
 */
export function scopeKey(classGroups: readonly string[]): string {
  return JSON.stringify([...classGroups].sort());
}

/** The collapsed filter's label. */
export function narrowedLabel(classGroups: readonly string[]): string {
  if (classGroups.length === 0) return "Narrow by class";
  if (classGroups.length <= 3) return `Narrowed to ${classGroups.join(", ")}`;
  return `Narrowed to ${classGroups.length} classes`;
}
