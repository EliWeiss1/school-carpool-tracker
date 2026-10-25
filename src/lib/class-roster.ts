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
  /** Every class the student belongs to, in class order; empty when none. */
  class_groups: string[];
  status: StudentStatus;
  /** Students sharing a carpool_id ride together; null means no carpool. */
  carpool_id: string | null;
  /** Nicknames, so the search box's suggestions find them too. */
  aliases?: string[];
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

/** One student picked, with the class they are filed under. */
export interface PadPick {
  classGroup: string;
  studentId: string;
}

/** Stable sort so a name never jumps position between renders. */
function byName(a: PadStudent, b: PadStudent): number {
  return (
    a.last_name.localeCompare(b.last_name, undefined, {
      sensitivity: "base",
    }) ||
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

/**
 * One class's students, A to Z by surname. A student in several classes is
 * listed in each of them; a student in none is listed in no drawer (they are
 * still reachable through the typed search).
 */
export function studentsInClass(
  roster: readonly PadStudent[],
  classGroup: string,
): PadStudent[] {
  return roster.filter((s) => s.class_groups.includes(classGroup)).sort(byName);
}

/** A student's classes for a label: "K1, 2nd", or a plain note when they have none. */
export function classesLabel(classGroups: readonly string[]): string {
  return classGroups.length > 0 ? classGroups.join(", ") : "No class on file";
}

/**
 * The class a pick is filed under. The drawer the staff member tapped in wins
 * when the student belongs to it; otherwise their first class, or "" for a
 * student with none (a key no filter keeps, which is right: nothing on screen
 * shows them, so nothing should keep them picked).
 */
export function pickClassFor(
  student: Pick<PadStudent, "class_groups">,
  preferred?: string | null,
): string {
  if (preferred != null && student.class_groups.includes(preferred)) {
    return preferred;
  }
  return student.class_groups[0] ?? "";
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

/**
 * Picks or un-picks a student. A multi-class student can appear in several
 * drawers, so a student picked anywhere counts as picked everywhere: a toggle
 * then un-picks them from every class, and only a student not yet picked is
 * added, under `classGroup`.
 */
export function toggleSelected(
  selection: PadSelection,
  classGroup: string,
  studentId: string,
): PadSelection {
  if (isSelected(selection, studentId))
    return removeIds(selection, [studentId]);
  return withClass(selection, classGroup, [
    ...(selection[classGroup] ?? []),
    studentId,
  ]);
}

/** Whether the student is picked in any class's drawer. */
export function isSelected(
  selection: PadSelection,
  studentId: string,
): boolean {
  return Object.values(selection).some((ids) => ids.includes(studentId));
}

/** Every selected id, across classes, in the order the classes were first picked from. */
export function selectedIds(selection: PadSelection): string[] {
  return Object.values(selection).flat();
}

/**
 * Every selected student exactly once. A multi-class student picked in two
 * drawers is two entries in `selectedIds` but one person: this is the list to
 * count and to send to `set-status`, so they are announced (and audited) once.
 */
export function uniqueSelectedIds(selection: PadSelection): string[] {
  return [...new Set(selectedIds(selection))];
}

export function selectedCountIn(
  selection: PadSelection,
  classGroup: string,
): number {
  return selection[classGroup]?.length ?? 0;
}

/**
 * How many of a class's students are picked, wherever they were picked from.
 * A multi-class student picked in one drawer counts in each of their classes,
 * matching the tick the other drawer shows for them.
 */
export function pickedCountInClass(
  roster: readonly PadStudent[],
  selection: PadSelection,
  classGroup: string,
): number {
  return studentsInClass(roster, classGroup).filter((s) =>
    isSelected(selection, s.id),
  ).length;
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

/**
 * Adds picks, skipping anyone already picked in any class (not a toggle: a
 * multi-class student picked from another drawer must stay picked), so a
 * repeat is harmless.
 */
export function addSelected(
  selection: PadSelection,
  picks: readonly PadPick[],
): PadSelection {
  let next = selection;
  for (const { classGroup, studentId } of picks) {
    if (isSelected(next, studentId)) continue;
    next = withClass(next, classGroup, [
      ...(next[classGroup] ?? []),
      studentId,
    ]);
  }
  return next;
}

/* -------------------------------------------------------------------------- */
/* Carpools                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Everyone who could be announced together with `student`: their carpool's
 * members who are still waiting, the student included, A to Z. A carpool
 * member who has already arrived is left out -- announcing them again would
 * change nothing -- and a student with no carpool gets just themselves.
 *
 * Members are found across the whole roster, not one class: siblings are often
 * in different classes.
 */
export function carpoolMembers(
  roster: readonly PadStudent[],
  student: PadStudent,
): PadStudent[] {
  if (student.carpool_id === null) return [student];
  return roster
    .filter(
      (s) => s.carpool_id === student.carpool_id && s.status === "waiting",
    )
    .sort(byName);
}

export type TapAction = "unannounce" | "deselect" | "prompt" | "select";

/**
 * What tapping a name in the drawer does. Kept here, not in the component, so
 * the rules are tested:
 * - a green (arrived) name is the reverse of announcing -- send them back;
 * - a picked name is simply un-picked;
 * - a waiting name with waiting carpool-mates asks who is riding first;
 * - anyone else is just picked.
 */
export function tapAction(
  roster: readonly PadStudent[],
  selection: PadSelection,
  student: PadStudent,
): TapAction {
  if (student.status === "arrived") return "unannounce";
  if (isSelected(selection, student.id)) return "deselect";
  return carpoolMembers(roster, student).length > 1 ? "prompt" : "select";
}

/**
 * The picks a confirmed prompt adds: every member except the un-ticked ones,
 * each filed under `openClass` when they belong to it, else their first class.
 */
export function promptPicks(
  members: readonly PadStudent[],
  unchecked: readonly string[],
  openClass?: string | null,
): PadPick[] {
  const off = new Set(unchecked);
  return members
    .filter((m) => !off.has(m.id))
    .map((m) => ({ classGroup: pickClassFor(m, openClass), studentId: m.id }));
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

/**
 * The header's class-filter button. Short on purpose -- it shares one ink
 * line with the title and the Lock button on a 320px phone.
 */
export function classFilterLabel(classGroups: readonly string[]): string {
  if (classGroups.length === 0) return "All classes";
  if (classGroups.length === 1) return classGroups[0];
  return `${classGroups.length} classes`;
}

/** What a 56px-wide rail button can show: one or two short lines. */
export interface RailLabel {
  top: string;
  bottom?: string;
}

/** A name this short fits the rail button whole. */
const RAIL_WHOLE_MAX = 4;
/** A leading word this short ("EC", "K1") is a prefix worth keeping as-is. */
const RAIL_PREFIX_MAX = 3;
/** Letters taken from a word to begin with, and the most ever taken. */
const RAIL_ABBREV_MIN = 3;
const RAIL_ABBREV_MAX = 6;

/**
 * Short rail labels for every class, keyed by the full name.
 *
 * The rail is 56px wide, so "EC Hummingbirds" truncated to "EC Hu…" and every
 * button in a family of "EC …" classes read the same. So:
 *
 * - A short first word that no other class starts with stands alone ("6th",
 *   "7th", "8th" for "6th Grade", "7th Grade", "8th Grade"): it already says
 *   everything the rest would add.
 * - Otherwise a short leading word stays as the top line and the rest is cut
 *   to its first few letters in caps ("EC" / "HUM"), the way a pigeonhole or a
 *   bus route is labelled. A family whose rests include a four-letter whole
 *   word ("MS Boys") takes four letters throughout ("BOYS" / "GIRL"), so the
 *   siblings line up and the whole word is not clipped to "BOY".
 * - Letters are added until no two classes collide, so "Robins" and "Robots"
 *   become "ROBI" and "ROBO" rather than two "ROB"s.
 *
 * The full name is still the drawer's heading and the button's accessible
 * name; this is only what fits.
 */
export function railLabels(
  classGroups: readonly string[],
): Map<string, RailLabel> {
  const wordsOf = (name: string) => name.trim().split(/\s+/).filter(Boolean);
  const firstWordCounts = new Map<string, number>();
  for (const name of classGroups) {
    const first = (wordsOf(name)[0] ?? name).toLowerCase();
    firstWordCounts.set(first, (firstWordCounts.get(first) ?? 0) + 1);
  }

  const parts = classGroups.map((name) => {
    const words = wordsOf(name);
    if (name.length <= RAIL_WHOLE_MAX) {
      return { name, fixed: { top: name } as RailLabel };
    }
    const first = words[0] ?? name;
    const uniqueFirst =
      words.length > 1 &&
      first.length <= RAIL_WHOLE_MAX &&
      firstWordCounts.get(first.toLowerCase()) === 1;
    if (uniqueFirst) return { name, fixed: { top: first } as RailLabel };

    const hasPrefix = words.length > 1 && first.length <= RAIL_PREFIX_MAX;
    return {
      name,
      fixed: undefined,
      prefix: hasPrefix ? first : undefined,
      rest: (hasPrefix ? words.slice(1) : words).join(""),
    };
  });

  // A prefix family with a four-letter whole-word rest starts at four letters.
  const familyStart = new Map<string, number>();
  for (const part of parts) {
    if (part.fixed !== undefined) continue;
    const family = (part.prefix ?? "").toLowerCase();
    if (part.rest.length === RAIL_WHOLE_MAX)
      familyStart.set(family, RAIL_WHOLE_MAX);
  }

  const labels = new Map<string, RailLabel>();
  const flexible = [];
  for (const part of parts) {
    if (part.fixed !== undefined) labels.set(part.name, part.fixed);
    else flexible.push(part);
  }

  let length = RAIL_ABBREV_MIN;
  let pending = flexible;

  // Widen only the colliding labels, one letter at a time, so a unique
  // class keeps its shortest form.
  while (pending.length > 0) {
    const candidates = pending.map((part) => {
      const start = familyStart.get((part.prefix ?? "").toLowerCase()) ?? 0;
      const letters = part.rest.slice(0, Math.max(length, start)).toUpperCase();
      return {
        name: part.name,
        label: part.prefix
          ? { top: part.prefix, bottom: letters }
          : { top: letters },
      };
    });
    const key = (label: RailLabel) => `${label.top}|${label.bottom ?? ""}`;
    const seen = new Map<string, number>();
    for (const { label } of candidates) {
      seen.set(key(label), (seen.get(key(label)) ?? 0) + 1);
    }
    for (const label of labels.values()) {
      seen.set(key(label), (seen.get(key(label)) ?? 0) + 1);
    }

    const stillColliding = new Set<string>();
    for (const { name, label } of candidates) {
      if ((seen.get(key(label)) ?? 0) > 1 && length < RAIL_ABBREV_MAX) {
        stillColliding.add(name);
      } else {
        labels.set(name, label);
      }
    }
    pending = pending.filter((part) => stillColliding.has(part.name));
    length += 1;
  }

  return labels;
}
