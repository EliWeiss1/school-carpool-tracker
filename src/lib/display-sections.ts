import { CLASS_GROUPS } from "@/lib/classes";
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
 * flashing or chiming, so a 3rd-class teacher's screen is never chimed for a
 * 5th-class arrival.
 */

export interface DisplayFilter {
  /** A section key from `options`, or "" for every class. */
  sectionKey: string;
}

export interface DisplaySection {
  key: string;
  classGroup: string | null;
  /** The bare class name, e.g. "3rd", or "Ungrouped" when a student has none. */
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

function sectionKeyFor(student: Student): string {
  return student.class_group ?? "__none__";
}

function labelFor(classGroup: string | null): string {
  return classGroup ?? "Ungrouped";
}

/**
 * Orders by position in the known class list (K1, K2, 1st .. 5th); a
 * class_group that isn't one of those (free text, so always possible) sorts
 * after every known class, alphabetically among themselves.
 */
function compareClasses(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const indexA = CLASS_GROUPS.indexOf(a as (typeof CLASS_GROUPS)[number]);
  const indexB = CLASS_GROUPS.indexOf(b as (typeof CLASS_GROUPS)[number]);
  if (indexA !== -1 && indexB !== -1) return indexA - indexB;
  if (indexA !== -1) return -1;
  if (indexB !== -1) return 1;
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
      const classGroup = sorted[0]?.class_group ?? null;
      return {
        key,
        classGroup,
        label: labelFor(classGroup),
        students: sorted,
        waiting: sorted.filter((s) => s.status === "waiting").length,
        arrived: sorted.filter((s) => s.status === "arrived").length,
      };
    })
    .sort((a, b) => {
      if (a.key === "__none__") return 1;
      if (b.key === "__none__") return -1;
      return compareClasses(a.classGroup, b.classGroup);
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
