/**
 * Pure helpers for the "which classes is this student in" checkbox group, kept
 * out of the form component so the rules are unit-testable without a DOM.
 */

/**
 * Returns the next selection after one checkbox flips.
 *
 * Output is ordered by `allClassNames` (the admin's sort order), not by click
 * order, so the same set always submits the same array. A name the student
 * already has that is no longer in `allClassNames` is kept at the end instead
 * of being dropped: an edit that changes the classes sends the full set, and silently
 * un-enrolling a student from a class the form cannot show would be data loss.
 */
export function toggleClass(
  selected: readonly string[],
  name: string,
  checked: boolean,
  allClassNames: readonly string[],
): string[] {
  const next = new Set(selected);
  if (checked) next.add(name);
  else next.delete(name);

  const known = allClassNames.filter((className) => next.has(className));
  const unknown = [...next].filter(
    (className) => !allClassNames.includes(className),
  );
  return [...known, ...unknown];
}

/**
 * True when `chosen` is a different SET of classes from `original`: order is
 * ignored, names compare exactly as stored. An edit sends `class_groups` only
 * when this is true, so a name-only save never overwrites a class another
 * admin added in the meantime, and never re-submits a stale class name the
 * server would refuse.
 */
export function classSetChanged(
  original: readonly string[],
  chosen: readonly string[],
): boolean {
  const before = new Set(original);
  const after = new Set(chosen);
  if (before.size !== after.size) return true;
  for (const name of after) {
    if (!before.has(name)) return true;
  }
  return false;
}
