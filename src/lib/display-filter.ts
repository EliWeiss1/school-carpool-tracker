import type { FilterOption } from "@/lib/display-sections";

/**
 * Pure decisions behind `/display`'s class filter, kept out of the component
 * so they can be unit-tested without a DOM (the repo's Vitest runs in node).
 */

/**
 * Finds the dropdown option a remembered or bookmarked value refers to.
 * Matches an option key exactly (what the filter stores) or its label
 * case-insensitively (what a person types into `?class=`). Resolving against
 * `options` rather than the sections on screen is what lets a bookmarked
 * class with nobody in it today still work. Null when the class no longer
 * exists.
 */
export function resolveSectionKey(
  candidate: string | null | undefined,
  options: readonly FilterOption[],
): string | null {
  if (!candidate) return null;
  const exact = options.find((option) => option.key === candidate);
  if (exact) return exact.key;
  const wanted = candidate.toLowerCase();
  return (
    options.find((option) => option.label.toLowerCase() === wanted)?.key ??
    null
  );
}

/**
 * The class the board opens to: the URL wins over what this browser
 * remembered, and anything that no longer exists falls back to "All classes"
 * (the empty key).
 */
export function resolveInitialSectionKey({
  urlParam,
  stored,
  options,
}: {
  urlParam: string | null;
  stored: string | null;
  options: readonly FilterOption[];
}): string {
  return (
    resolveSectionKey(urlParam, options) ??
    resolveSectionKey(stored, options) ??
    ""
  );
}

/**
 * The label to name in the "no students in X yet" message, or null when the
 * board should show tiles (or the filter is All classes / not a real option).
 */
export function emptyClassLabel(
  sectionKey: string,
  options: readonly FilterOption[],
  visibleSections: readonly unknown[],
): string | null {
  if (sectionKey === "" || visibleSections.length > 0) return null;
  return options.find((option) => option.key === sectionKey)?.label ?? null;
}
