/**
 * The fields a roster import can fill, and the headings a school's own
 * spreadsheet is likely to use for each.
 *
 * Kept apart from the parser so the column-mapping screen, the header
 * detector and the AI prompt all read one list: a new heading added here is
 * understood everywhere at once.
 */

/** A field that lands on a student row as-is. */
export type CsvField =
  | "first_name"
  | "last_name"
  | "aliases"
  | "class_groups"
  | "carpool"
  | "parent1_name"
  | "parent2_name";

/**
 * Everything a column can be. `full_name` is an input-only field: it is split
 * into first and last name before anything is imported.
 */
export type ImportField = CsvField | "full_name";

/** What the admin (or the detector) has decided one column is. */
export type ColumnAssignment = ImportField | "ignore";

/** Order of the choices in the mapping screen's dropdown. */
export const FIELD_ORDER: readonly ImportField[] = [
  "first_name",
  "last_name",
  "full_name",
  "class_groups",
  "carpool",
  "parent1_name",
  "parent2_name",
  "aliases",
];

/** Words a staff member would use, never the column name. */
export const FIELD_LABELS: Record<ColumnAssignment, string> = {
  first_name: "First name",
  last_name: "Last name",
  full_name: "Full name",
  class_groups: "Class",
  carpool: "Carpool",
  parent1_name: "Parent 1",
  parent2_name: "Parent 2",
  aliases: "Nicknames / other spellings",
  ignore: "Don't import this column",
};

/**
 * Exact headings, in their normalized form (see `normalizeHeading`), in
 * priority order: when two columns both match a field, the one whose heading
 * comes earlier in this list wins. That is what lets "last_name" beat "last"
 * regardless of which sits further left in the file.
 */
export const HEADER_ALIASES: Record<ImportField, readonly string[]> = {
  first_name: [
    "first name",
    "firstname",
    "fname",
    "given name",
    "forename",
    "first",
  ],
  last_name: [
    "last name",
    "lastname",
    "lname",
    "surname",
    "family name",
    "last",
  ],
  full_name: ["full name", "name", "names", "fullname", "student", "child"],
  aliases: [
    "aliases",
    "alias",
    "alternate spellings",
    "alt names",
    "nicknames",
    "nickname",
    "also known as",
    "aka",
    "goes by",
  ],
  // "grade" and "teacher" are here even though the app has neither concept: a
  // school's own export still calls this column "Grade" or "Teacher" and puts
  // the thing it groups children by in it, and that is exactly what a class is
  // here. The cell may list several classes separated by semicolons.
  class_groups: [
    "class groups",
    "class group",
    "classes",
    "class",
    "classroom",
    "class name",
    "homeroom",
    "home room",
    "grade",
    "grade level",
    "teacher",
    "homeroom teacher",
    "room",
    "group",
    "section",
  ],
  carpool: [
    "carpool",
    "carpool name",
    "car pool",
    "carpool group",
    "ride group",
    "ride",
    "rides with",
    "pickup group",
    "pick up group",
  ],
  parent1_name: [
    "parent1 name",
    "parent 1 name",
    "parent 1",
    "parent1",
    "mother",
    "mother name",
    "mothers name",
    "mom",
    "guardian 1",
    "guardian",
    "parent",
    "parent name",
    "parent guardian",
    "primary contact",
    "contact 1",
  ],
  parent2_name: [
    "parent2 name",
    "parent 2 name",
    "parent 2",
    "parent2",
    "father",
    "father name",
    "fathers name",
    "dad",
    "guardian 2",
    "secondary contact",
    "contact 2",
  ],
};

/**
 * A heading that mentions one of these words is offered as that field, but
 * marked "check this" rather than trusted: "Teacher email" contains "teacher"
 * and is not a class.
 */
export const LOOSE_HINTS: readonly {
  field: ImportField;
  words: readonly string[];
}[] = [
  { field: "first_name", words: ["first", "given"] },
  { field: "last_name", words: ["last", "surname", "family"] },
  { field: "carpool", words: ["carpool", "carpools", "ride", "rides"] },
  {
    field: "class_groups",
    words: ["class", "classes", "grade", "homeroom", "teacher", "room"],
  },
  {
    field: "parent1_name",
    words: ["parent", "parents", "mother", "mom", "father", "dad", "guardian"],
  },
  { field: "aliases", words: ["alias", "aliases", "nickname", "nicknames"] },
  { field: "full_name", words: ["name"] },
];

/** Leading words that say whose name it is rather than which name it is. */
const SUBJECT_PREFIXES = ["student", "child", "pupil", "kid", "camper"];

/**
 * "Student First Name", "child's_last_name" and "FIRST-NAME:" all become
 * "first name". A heading that is *only* a subject word ("Student") keeps it,
 * since then it is the name column itself.
 */
export function normalizeHeading(raw: string): string {
  const base = raw
    .toLowerCase()
    // Not `\b`: "child's_last_name" has "_" after the s, a word character.
    .replace(/['’]s(?![a-z0-9])/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  const words = base.split(" ");
  if (words.length > 1 && SUBJECT_PREFIXES.includes(words[0])) {
    return words.slice(1).join(" ");
  }
  return base;
}
