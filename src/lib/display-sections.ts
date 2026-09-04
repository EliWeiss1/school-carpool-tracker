import type { Student } from "@/types/db";

/**
 * Groups the roster into class sections and applies the per-viewer class
 * filter, for `/display`.
 *
 * Pure and dependency-free, the same treatment `realtime-reconcile.ts` gets:
 * the logic that decides what a viewer sees is where bugs in a realtime,
 * multi-viewer screen actually live, so it is driven by synthetic data in
 * Vitest rather than read out of the component.
 *
 * The filter is entirely client-side and per-viewer -- several teachers can
 * each filter to their own class off the one public realtime subscription,
 * with no server state and no extra query. `visibleIds` is what
 * `display-board.tsx` intersects against `reconcile`'s `arrivals` before
 * flashing or chiming, so a grade-3 teacher's screen is never chimed for a
 * grade-5 arrival.
 */

export interface DisplayFilter {
  /** A section key from `options`, or "" for every class. */
  sectionKey: string;
}

export interface DisplaySection {
  key: string;
  grade: string | null;
  classGroup: string | null;
  /** "Grade 3 · Foxes", or "Ungrouped" when a student has neither field set. */
  label: string;
  students: Student[];
  waiting: number;
  arrived: number;
}

export interface FilterOption {
  key: string;
  label: string;
  waiting: number;
}

export interface GroupedSections {
  /** Every section, unfiltered -- for the filter chip row's own counts. */
  allSections: DisplaySection[];
  /** Only the sections the current filter shows. */
  sections: DisplaySection[];
  /** Every student id belonging to a visible section, for scoping flash/chime. */
  visibleIds: Set<string>;
  /** Totals across the FILTERED view -- what the header's waiting/arrived count should show. */
  totals: { waiting: number; arrived: number };
  /** Chip choices for the filter control, ordered the same as `allSections`, waiting-heaviest first is NOT applied -- section order is preserved so the board reads the same way twice. */
  options: FilterOption[];
}

/** Stable ordering: by grade text, then class group, with unassigned last. */
function sectionKeyFor(student: Student): string {
  if (!student.grade && !student.class_group) return "__none__";
  return `${student.grade ?? ""}|${student.class_group ?? ""}`;
}

function labelFor(grade: string | null, classGroup: string | null): string {
  if (!grade && !classGroup) return "Ungrouped";
  const gradeLabel = grade ? `Grade ${grade}` : null;
  return [gradeLabel, classGroup].filter(Boolean).join(" · ");
}

/** Sorts grade text numerically when possible ("2" before "10"), else lexically ("K" before "1" is intentional -- K comes first). */
function compareGrades(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (a === "K" && b !== "K") return -1;
  if (b === "K" && a !== "K") return 1;
  const numA = Number(a);
  const numB = Number(b);
  if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA - numB;
  return a.localeCompare(b);
}

export function groupIntoSections(
  students: readonly Student[],
  filter: DisplayFilter,
): GroupedSections {
  const byKey = new Map<string, Student[]>();
  for (const student of students) {
    const key = sectionKeyFor(student);
    const list = byKey.get(key) ?? [];
    list.push(student);
    byKey.set(key, list);
  }

  const allSections: DisplaySection[] = [...byKey.entries()]
    .map(([key, members]) => {
      // Sort within a section stays by last name, matching the flat board's
      // existing rule: an arrival is a colour flip in place, never a reshuffle.
      const sorted = [...members].sort((a, b) => {
        const byLastName = a.last_name.localeCompare(b.last_name);
        return byLastName !== 0
          ? byLastName
          : a.first_name.localeCompare(b.first_name);
      });
      const grade = sorted[0]?.grade ?? null;
      const classGroup = sorted[0]?.class_group ?? null;
      return {
        key,
        grade,
        classGroup,
        label: labelFor(grade, classGroup),
        students: sorted,
        waiting: sorted.filter((s) => s.status === "waiting").length,
        arrived: sorted.filter((s) => s.status === "arrived").length,
      };
    })
    .sort((a, b) => {
      if (a.key === "__none__") return 1;
      if (b.key === "__none__") return -1;
      const byGrade = compareGrades(a.grade, b.grade);
      return byGrade !== 0
        ? byGrade
        : (a.classGroup ?? "").localeCompare(b.classGroup ?? "");
    });

  const sections =
    filter.sectionKey === ""
      ? allSections
      : allSections.filter((section) => section.key === filter.sectionKey);

  const visibleIds = new Set<string>();
  let waiting = 0;
  let arrived = 0;
  for (const section of sections) {
    for (const student of section.students) {
      visibleIds.add(student.id);
    }
    waiting += section.waiting;
    arrived += section.arrived;
  }

  const options: FilterOption[] = allSections.map((section) => ({
    key: section.key,
    label: section.label,
    waiting: section.waiting,
  }));

  return {
    allSections,
    sections,
    visibleIds,
    totals: { waiting, arrived },
    options,
  };
}
