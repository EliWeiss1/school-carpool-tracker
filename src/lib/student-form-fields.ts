/**
 * Turns the student form's raw input into the `StudentFields` it submits.
 * Pure, so the "what does a save actually send" rules are testable without
 * rendering the form.
 */

import type { StudentFields } from "@/lib/admin-api";
import { classSetChanged } from "@/lib/class-selection";

/** The carpool picker's "None" option. */
export const NO_CARPOOL = "";

/** What the form holds, as typed. */
export interface StudentFormValues {
  firstName: string;
  lastName: string;
  aliasesText: string;
  selectedClasses: readonly string[];
  /** `NO_CARPOOL` for none. */
  carpoolId: string;
  parent1Name: string;
  parent2Name: string;
}

/** Splits on comma or semicolon, same rule csv-import.ts uses for the aliases column. */
export function parseAliasesInput(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

function optionalName(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * The fields a save sends. With no `original` (adding a student) the classes
 * always go. Editing, `class_groups` is left out unless the admin actually
 * changed the set: the form's copy can be stale (another admin bulk-added the
 * student to a class after it opened), and an omitted key is how the update
 * endpoint is told to leave classes alone.
 */
export function buildStudentFields(
  values: StudentFormValues,
  original?: { class_groups: readonly string[] },
): StudentFields {
  const fields: StudentFields = {
    first_name: values.firstName.trim(),
    last_name: values.lastName.trim(),
    aliases: parseAliasesInput(values.aliasesText),
    carpool_id: values.carpoolId === NO_CARPOOL ? null : values.carpoolId,
    parent1_name: optionalName(values.parent1Name),
    parent2_name: optionalName(values.parent2Name),
  };
  if (
    original === undefined ||
    classSetChanged(original.class_groups, values.selectedClasses)
  ) {
    fields.class_groups = [...values.selectedClasses];
  }
  return fields;
}
