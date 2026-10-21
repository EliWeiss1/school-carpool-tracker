/**
 * Reading class names off a roster write, shared by /roster-write and
 * /roster-import.
 *
 * Kept apart from `roster-input.ts` (generic field parsing, plus
 * `resolveClassNames`, the name -> id lookup) because these are the wire rules
 * specific to multi-class membership: which spelling is accepted, which is the
 * retired one, and the sentences staff see when a name is wrong.
 */

import { MAX_NAME_LENGTH } from "./roster-input.ts";

/**
 * Sent in place of applying a request that still carries the retired singular
 * `class_group`. Mapping it to a one-element set would silently strip a
 * multi-class student's other classes, and ignoring it would silently drop the
 * edit, so a stale admin tab is told to reload instead.
 */
export const OUT_OF_DATE_MESSAGE =
  "This page is out of date. Reload it and try again.";

/** A student in more than this many classes is a malformed request. */
export const MAX_CLASSES_PER_STUDENT = 50;

/** True when the row still uses the retired singular `class_group` field. */
export function sendsLegacyClassGroup(row: Record<string, unknown>): boolean {
  return "class_group" in row;
}

/** What a row says about its classes: nothing, a list of names, or garbage. */
export type ClassNamesRead =
  { kind: "absent" } | { kind: "names"; names: string[] } | { kind: "invalid" };

/**
 * Reads `class_groups` as typed by a person (names, not ids). Absent is its own
 * answer, not an empty list, because an update that omits the field must leave
 * classes alone while `[]` clears them. Entries are passed through untouched:
 * trimming, case-folding and de-duplication belong to `resolveClassNames`, so
 * there is one place that decides when two spellings are the same class.
 */
export function readClassNames(row: Record<string, unknown>): ClassNamesRead {
  if (!("class_groups" in row)) return { kind: "absent" };

  const raw = row.class_groups;
  if (!Array.isArray(raw) || raw.length > MAX_CLASSES_PER_STUDENT) {
    return { kind: "invalid" };
  }

  const names: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || entry.length > MAX_NAME_LENGTH) {
      return { kind: "invalid" };
    }
    names.push(entry);
  }
  return { kind: "names", names };
}

/** One sentence for the admin who typed (or imported) a class that is not there. */
export function unknownClassMessage(name: string): string {
  return `There's no class called "${name}". Add it under Classes first.`;
}
