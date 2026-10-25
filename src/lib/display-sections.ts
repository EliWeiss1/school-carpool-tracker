import type { StudentWithClasses } from "@/types/db";

/**
 * Falls back to this when the live, admin-editable class order (see
 * `use-class-groups.ts`) hasn't loaded yet, or a caller (a test, the mock
 * preview) passes none -- the classes this app has always shipped with.
 * Never the source of truth once the real list has loaded.
 */
const DEFAULT_CLASS_ORDER = ["K1", "K2", "1st", "2nd", "3rd", "4th", "5th"];

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
 *
 * A student can belong to several classes. They appear in every one of their
 * sections (a teacher of either class must see them), but every count that
 * answers "how many children" -- the header totals and `visibleIds` -- counts
 * each child once, so a two-class child is never double-counted or
 * double-chimed. Per-section `waiting`/`arrived` are about that section only.
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
  students: StudentWithClasses[];
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
  /** Every distinct student id in a visible section, for scoping flash/chime. */
  visibleIds: Set<string>;
  /** Distinct-student totals across the FILTERED view -- what the header's waiting/arrived count should show. */
  totals: { waiting: number; arrived: number };
  /** Chip choices for the filter control, ordered the same as `allSections`, waiting-heaviest first is NOT applied -- section order is preserved so the board reads the same way twice. */
  options: FilterOption[];
}

const NO_CLASS_KEY = "__none__";

/**
 * The section keys a student is listed under: one per class, or only the
 * "Ungrouped" key when they have none. Ungrouped is for the classless alone --
 * a student with a class is never also shown there.
 */
function sectionKeysFor(student: StudentWithClasses): string[] {
  return student.class_groups.length > 0
    ? [...new Set(student.class_groups)]
    : [NO_CLASS_KEY];
}

function labelFor(classGroup: string | null): string {
  return classGroup ?? "Ungrouped";
}

/**
 * Orders by position in the admin-editable class list; a class_group that
 * isn't on that list (free text, so always possible) sorts after every known
 * class, alphabetically among themselves.
 */
function compareClasses(
  a: string | null,
  b: string | null,
  classOrder: readonly string[],
): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const indexA = classOrder.indexOf(a);
  const indexB = classOrder.indexOf(b);
  if (indexA !== -1 && indexB !== -1) return indexA - indexB;
  if (indexA !== -1) return -1;
  if (indexB !== -1) return 1;
  return a.localeCompare(b);
}

/**
 * The dropdown's choices. With a known class list, every class on it is
 * selectable -- an empty class (a teacher whose class has no students today,
 * or one an admin just created) must still be pickable on the day. Sections
 * for a class missing from the list follow (defensive: free text makes it
 * possible), then "Ungrouped" only if someone actually has no class.
 */
function buildOptions(
  allSections: readonly DisplaySection[],
  knownClasses: readonly string[] | null,
): FilterOption[] {
  const toOption = (section: DisplaySection): FilterOption => ({
    key: section.key,
    label: section.label,
    waiting: section.waiting,
  });
  if (knownClasses === null) return allSections.map(toOption);

  const sectionByKey = new Map(allSections.map((s) => [s.key, s]));
  const listed = new Set(knownClasses);
  const options: FilterOption[] = [...new Set(knownClasses)].map((name) => {
    const section = sectionByKey.get(name);
    return section ? toOption(section) : { key: name, label: name, waiting: 0 };
  });
  const unlisted = allSections.filter(
    (s) => s.classGroup !== null && !listed.has(s.classGroup),
  );
  const ungrouped = sectionByKey.get(NO_CLASS_KEY);
  return [
    ...options,
    ...unlisted.map(toOption),
    ...(ungrouped ? [toOption(ungrouped)] : []),
  ];
}

export function groupIntoSections(
  students: readonly StudentWithClasses[],
  filter: DisplayFilter,
  classOrder?: readonly string[],
): GroupedSections {
  // Only a real, non-empty class list makes every class selectable. Without
  // one (not loaded yet, failed to load, a caller that has none) the dropdown
  // is derived from the sections, as it always was, rather than flickering
  // through a worse state while the list loads.
  const knownClasses =
    classOrder !== undefined && classOrder.length > 0 ? classOrder : null;
  const sortOrder = knownClasses ?? DEFAULT_CLASS_ORDER;
  const byKey = new Map<string, StudentWithClasses[]>();
  for (const student of students) {
    for (const key of sectionKeysFor(student)) {
      const list = byKey.get(key) ?? [];
      list.push(student);
      byKey.set(key, list);
    }
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
      const classGroup = key === NO_CLASS_KEY ? null : key;
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
      if (a.key === NO_CLASS_KEY) return 1;
      if (b.key === NO_CLASS_KEY) return -1;
      return compareClasses(a.classGroup, b.classGroup, sortOrder);
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
      // A two-class student is in two sections but is still one child.
      if (visibleIds.has(student.id)) continue;
      visibleIds.add(student.id);
      if (student.status === "waiting") waiting += 1;
      if (student.status === "arrived") arrived += 1;
    }
  }

  const options = buildOptions(allSections, knownClasses);

  return {
    allSections,
    sections,
    visibleIds,
    totals: { waiting, arrived },
    options,
  };
}
