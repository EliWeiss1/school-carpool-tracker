/**
 * Sibling carpool suggestions, and the carpool summary the review step shows.
 *
 * Many schools never wrote carpools down anywhere: siblings simply leave
 * together. A carpool here is what lets one spoken name call every child in a
 * family, so offering "these look like one family" saves an admin from
 * building each one by hand.
 *
 * The rule errs towards *not* merging, because merging two families is the
 * expensive mistake: calling "Cohen" would then send another family's
 * children out. So:
 *   - only students the file gave no carpool are considered, and a suggestion
 *     never overrides a carpool the file names;
 *   - with parent names, siblings must share a surname AND a parent name;
 *   - with no parent names at all, a shared surname is offered, but unchecked,
 *     marked as the weaker guess, for a person to confirm.
 */

import type { CsvImportStudent } from "../csv-import";

/**
 * - "parents": siblings share a full parent name ("Sarah Cohen"). Ticked.
 * - "parent-first-name": they share only a one-word parent value ("Sarah"),
 *   which two unrelated Cohen families can easily both have. Unticked.
 * - "surname": the file has no parent names at all. Unticked.
 */
export type SuggestionBasis = "parents" | "parent-first-name" | "surname";

export interface CarpoolSuggestion {
  /** Stable for the same file, so a checkbox survives re-renders. */
  id: string;
  /** The carpool name it would create. Unique against existing carpools. */
  name: string;
  /** Indexes into the `students` array passed in. */
  memberIndexes: number[];
  basis: SuggestionBasis;
  /** Whether the review step should start with it ticked. */
  recommended: boolean;
}

function key(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Values a school writes in an empty parent cell. Two families both marked
 * "N/A" share nothing, so these must never link children together.
 */
const PLACEHOLDERS = new Set([
  "n/a",
  "na",
  "n.a.",
  "none",
  "unknown",
  "tbd",
  "tba",
  "not listed",
  "not applicable",
  "same",
  "same as above",
]);

function parentKeys(student: CsvImportStudent): string[] {
  return [student.parent1_name, student.parent2_name]
    .filter((name): name is string => name !== null)
    .map(key)
    .filter((name) => /\p{L}/u.test(name) && !PLACEHOLDERS.has(name));
}

/** Parent values at least two members of a cluster share. */
function sharedParents(
  members: number[],
  students: readonly CsvImportStudent[],
): string[] {
  const counts = new Map<string, number>();
  for (const index of members) {
    for (const name of new Set(parentKeys(students[index]))) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts].filter(([, n]) => n >= 2).map(([name]) => name);
}

/** Groups indexes that share any parent name (union-find over a few rows). */
function clusterByParents(
  indexes: number[],
  students: readonly CsvImportStudent[],
): number[][] {
  const parent = new Map<number, number>(indexes.map((i) => [i, i]));
  const find = (i: number): number => {
    let root = i;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(i, root);
    return root;
  };
  const byParent = new Map<string, number>();
  for (const index of indexes) {
    for (const name of parentKeys(students[index])) {
      const other = byParent.get(name);
      if (other === undefined) byParent.set(name, index);
      else parent.set(find(index), find(other));
    }
  }
  const groups = new Map<number, number[]>();
  for (const index of indexes) {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), index]);
  }
  return [...groups.values()];
}

function firstWord(value: string | null): string | null {
  const word = value?.trim().split(/\s+/)[0];
  return word ? word : null;
}

/**
 * @param reservedNames carpool names already in use (existing carpools and
 *   names typed in the file), so a suggestion never silently joins one.
 */
export function suggestSiblingCarpools(
  students: readonly CsvImportStudent[],
  reservedNames: readonly string[] = [],
): CarpoolSuggestion[] {
  const fileHasParents = students.some((s) => parentKeys(s).length > 0);

  const bySurname = new Map<string, number[]>();
  students.forEach((student, index) => {
    if (student.carpool !== null) return;
    const surname = key(student.last_name);
    bySurname.set(surname, [...(bySurname.get(surname) ?? []), index]);
  });

  const used = new Set(reservedNames.map(key));
  const uniqueName = (base: string): string => {
    let name = base;
    for (let n = 2; used.has(key(name)); n++) name = `${base} ${n}`;
    used.add(key(name));
    return name;
  };

  const suggestions: CarpoolSuggestion[] = [];
  for (const indexes of bySurname.values()) {
    if (indexes.length < 2) continue;

    let groups: { members: number[]; basis: SuggestionBasis }[];
    if (fileHasParents) {
      // A child with no parent listed can't be tied to either family safely.
      const withParents = indexes.filter(
        (i) => parentKeys(students[i]).length > 0,
      );
      groups = clusterByParents(withParents, students).map((members) => ({
        members,
        // Only a shared full name ("Sarah Cohen") is strong enough to tick
        // by default; "Sarah" alone is offered for a person to judge.
        basis: sharedParents(members, students).some((name) =>
          name.includes(" "),
        )
          ? ("parents" as const)
          : ("parent-first-name" as const),
      }));
    } else {
      groups = [{ members: indexes, basis: "surname" }];
    }

    const families = groups.filter((g) => g.members.length >= 2);
    for (const { members, basis } of families) {
      const lead = students[members[0]];
      const surname = lead.last_name.trim();
      // Two Cohen families get told apart by a parent's first name.
      const parentHint =
        families.length > 1
          ? firstWord(lead.parent1_name ?? lead.parent2_name)
          : null;
      const base = parentHint
        ? `${surname} family (${parentHint})`
        : `${surname} family`;
      suggestions.push({
        id: `${basis}:${members.join(",")}`,
        name: uniqueName(base),
        memberIndexes: members,
        basis,
        recommended: basis === "parents",
      });
    }
  }

  return suggestions;
}

/** The students with every accepted suggestion's carpool filled in. */
export function applySuggestions(
  students: readonly CsvImportStudent[],
  suggestions: readonly CarpoolSuggestion[],
  acceptedIds: ReadonlySet<string>,
): CsvImportStudent[] {
  const carpoolFor = new Map<number, string>();
  for (const suggestion of suggestions) {
    if (!acceptedIds.has(suggestion.id)) continue;
    for (const index of suggestion.memberIndexes) {
      carpoolFor.set(index, suggestion.name);
    }
  }
  return students.map((student, index) => {
    const carpool = carpoolFor.get(index);
    return carpool && student.carpool === null
      ? { ...student, carpool }
      : student;
  });
}

export interface CarpoolSummary {
  name: string;
  memberCount: number;
  /** False when it matches a carpool that already exists (case-insensitively). */
  isNew: boolean;
}

/**
 * Every carpool the import will create or join, with how many students each
 * gets. A typo in the file shows up here as its own one-child carpool.
 */
export function summarizeCarpools(
  students: readonly CsvImportStudent[],
  existingNames: readonly string[] = [],
): CarpoolSummary[] {
  const existing = new Map(existingNames.map((name) => [key(name), name]));
  const summary = new Map<string, CarpoolSummary>();
  for (const student of students) {
    if (student.carpool === null) continue;
    const k = key(student.carpool);
    const entry = summary.get(k);
    if (entry) {
      entry.memberCount++;
    } else {
      summary.set(k, {
        name: existing.get(k) ?? student.carpool,
        memberCount: 1,
        isNew: !existing.has(k),
      });
    }
  }
  return [...summary.values()].sort((a, b) => a.name.localeCompare(b.name));
}
