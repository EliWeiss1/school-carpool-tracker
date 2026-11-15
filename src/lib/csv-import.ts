/**
 * Turns a roster spreadsheet into a validation report, never a crash.
 *
 * Pure logic, no DOM and no network, so it runs the same in a unit test and in
 * the browser. Nothing here writes anywhere -- `/admin` shows this report and
 * only calls `roster-import` after a person has looked at it and confirmed.
 *
 * The pipeline, each step its own module under `src/lib/import/`:
 *   source (file or paste) -> grid           read-source.ts
 *   grid -> layout (headings, column fields)  detect-columns.ts
 *   grid + layout -> this report              buildImportReport, below
 *
 * `parseRosterCsv` runs the whole pipeline on CSV text with every guess
 * accepted; the import screen runs the steps separately so the admin can
 * correct the layout between them.
 */

import type { ColumnAssignment } from "./import/fields";
import {
  type ImportLayout,
  detectLayout,
  layoutProblems,
} from "./import/detect-columns";
import { textToGrid } from "./import/read-source";
import { splitFullName } from "./import/split-name";

export type { CsvField } from "./import/fields";

export interface CsvImportStudent {
  first_name: string;
  last_name: string;
  aliases: string[];
  /**
   * Class NAMES as typed in the file (resolved to ids server-side), already
   * trimmed and de-duplicated. Empty means "no classes", never null.
   */
  class_groups: string[];
  /** The carpool name as typed in the file. Resolved to an id server-side. */
  carpool: string | null;
  parent1_name: string | null;
  parent2_name: string | null;
}

export interface CsvImportError {
  /** 1-based, the row number the spreadsheet itself shows. */
  rowNumber: number;
  message: string;
}

export interface RosterMatch {
  rowNumber: number;
  name: string;
}

export interface CsvImportReport {
  /** Non-empty only when the file cannot be read at all (no names, bad quoting). */
  headerErrors: string[];
  /** What will actually be written if the person confirms. */
  toImport: CsvImportStudent[];
  /** The spreadsheet row each `toImport` entry came from, index for index. */
  toImportRows: number[];
  /** Per-row problems, each skipped rather than aborting the whole file. */
  errors: CsvImportError[];
  /** Rows that were empty or whitespace-only. Not an error -- just not data. */
  blankRowsSkipped: number;
  /** Rows above the headings (a title, a date). Not data. */
  titleRowsSkipped: number;
  /** Data rows below the headings, blank ones included. */
  totalDataRows: number;
  /**
   * Non-empty headings the layout ignores, exactly as written. Surfaced rather
   * than silently dropped: a column the importer doesn't recognise used to
   * vanish with no signal at all, which is exactly how a school's "Grade"
   * column full of class names once went missing with no error anywhere.
   */
  unrecognizedHeaders: string[];
  /**
   * Classes the file names that don't exist yet, first spelling kept. Created
   * on import when `unknownClasses` is "create"; otherwise always empty
   * (those rows are errors instead).
   */
  newClasses: string[];
  /** Students skipped because they are already on the roster. */
  alreadyOnRoster: RosterMatch[];
}

export interface ImportContext {
  /** The live class names. Empty means "unknown" and skips class checks. */
  knownClassNames?: readonly string[];
  /**
   * "reject" makes a class the app doesn't have a row error (the original
   * behaviour); "create" collects it into `newClasses` for the admin to
   * approve. Defaults to "reject".
   */
  unknownClasses?: "reject" | "create";
  /** The current roster, so re-importing a file skips who is already there. */
  rosterNames?: readonly { first_name: string; last_name: string }[];
}

/**
 * Nothing between a file and Postgres bounded a name, and the columns are
 * bare `text`. An unbounded surname does not just sit there: keyterms.ts pushes
 * it into the Deepgram keyterm list, which plausibly breaks token minting for
 * the whole school, and /display renders it as one enormous tile.
 *
 * 120 is far past any real name and far short of a problem. The server uses
 * the same limit for class names.
 */
export const MAX_NAME_LENGTH = 120;

/** The server's cap on classes; creating past it would fail the whole import. */
export const MAX_CLASSES = 100;

function collapse(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** Aliases split on comma or semicolon, so a quoted "Kohen, Cohn" cell and a semicolon-delimited one both work. */
function splitAliases(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map(collapse)
    .filter((entry) => entry !== "");
}

/**
 * One cell -> the classes a student belongs to. Split on `;` only (a comma can
 * sit inside a class name such as "Room 1, Annex"), trimmed, empties dropped,
 * and de-duplicated case-insensitively keeping the first spelling the file used.
 */
function splitClasses(raw: string): string[] {
  const seen = new Set<string>();
  const classes: string[] = [];
  for (const segment of raw.split(";")) {
    const name = collapse(segment);
    if (name === "") continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    classes.push(name);
  }
  return classes;
}

function nullableCollapse(value: string | undefined): string | null {
  const collapsed = collapse(value ?? "");
  return collapsed === "" ? null : collapsed;
}

/** Same key as the server's duplicate guard (`roster-input.ts` nameKey). */
export function studentNameKey(firstName: string, lastName: string): string {
  return `${firstName.trim().toLowerCase()}\u0000${lastName.trim().toLowerCase()}`;
}

function emptyReport(
  headerErrors: string[],
  overrides: Partial<CsvImportReport> = {},
): CsvImportReport {
  return {
    headerErrors,
    toImport: [],
    toImportRows: [],
    errors: [],
    blankRowsSkipped: 0,
    titleRowsSkipped: 0,
    totalDataRows: 0,
    unrecognizedHeaders: [],
    newClasses: [],
    alreadyOnRoster: [],
    ...overrides,
  };
}

export const UNTERMINATED_QUOTE_MESSAGE =
  "A quotation mark in this file is never closed, so the rows after it cannot be read. Fix the quotation mark and export the file again.";

/**
 * Validates every data row against a layout the admin has confirmed (or the
 * detector proposed).
 */
export function buildImportReport(
  grid: readonly (readonly string[])[],
  layout: ImportLayout,
  context: ImportContext = {},
): CsvImportReport {
  if (grid.length === 0) return emptyReport(["The file is empty."]);

  const { headerRowIndex, assignments, nameOrder } = layout;
  const dataStart = headerRowIndex + 1;
  const dataRows = grid.slice(dataStart);
  const titleRowsSkipped = Math.max(0, headerRowIndex);

  const problems = layoutProblems(assignments);
  if (problems.length > 0) {
    return emptyReport(problems, {
      totalDataRows: dataRows.length,
      titleRowsSkipped,
    });
  }

  const column = (field: ColumnAssignment): number | undefined => {
    const index = assignments.indexOf(field);
    return index === -1 ? undefined : index;
  };
  const firstCol = column("first_name");
  const lastCol = column("last_name");
  const useSplit = firstCol === undefined || lastCol === undefined;
  const fullCol = column("full_name");
  const classCol = column("class_groups");
  const carpoolCol = column("carpool");
  const aliasCol = column("aliases");
  const parent1Col = column("parent1_name");
  const parent2Col = column("parent2_name");

  const headerRow = headerRowIndex >= 0 ? (grid[headerRowIndex] ?? []) : [];
  const unrecognizedHeaders = headerRow.filter(
    (cell, index) =>
      cell.trim() !== "" && (assignments[index] ?? "ignore") === "ignore",
  );
  // A data cell beyond the last heading is a value nobody named. Empty ones
  // are just how spreadsheets pad; a filled one is a real misalignment.
  const width = headerRowIndex >= 0 ? headerRow.length : assignments.length;

  const knownClasses = new Map<string, string>();
  for (const name of context.knownClassNames ?? []) {
    knownClasses.set(collapse(name).toLowerCase(), name);
  }
  const createClasses = context.unknownClasses === "create";
  // An empty list used to mean "not loaded, let the server decide". In create
  // mode it is a brand-new school, and every class in the file is new.
  const checkClasses = knownClasses.size > 0 || createClasses;
  const newClasses = new Map<string, string>();

  const onRoster = new Set(
    (context.rosterNames ?? []).map((s) =>
      studentNameKey(s.first_name, s.last_name),
    ),
  );

  const toImport: CsvImportStudent[] = [];
  const toImportRows: number[] = [];
  const errors: CsvImportError[] = [];
  const alreadyOnRoster: RosterMatch[] = [];
  let blankRowsSkipped = 0;
  // Full name -> the row it first appeared on, so a later duplicate can point
  // back to it.
  const seenNames = new Map<string, number>();

  dataRows.forEach((fields, offset) => {
    const rowNumber = dataStart + offset + 1;

    if (fields.every((field) => field.trim() === "")) {
      blankRowsSkipped++;
      return;
    }

    if (fields.slice(width).some((field) => field.trim() !== "")) {
      errors.push({
        rowNumber,
        message: `This row has ${fields.length} cells but there are only ${width} columns with headings, so its values may be in the wrong columns.`,
      });
      return;
    }

    const cell = (index: number | undefined) =>
      index === undefined ? "" : (fields[index] ?? "");

    let firstName: string;
    let lastName: string;
    if (useSplit) {
      const full = collapse(cell(fullCol));
      if (full === "") {
        errors.push({ rowNumber, message: "Missing a name." });
        return;
      }
      const split = splitFullName(full, nameOrder);
      if (!split) {
        errors.push({
          rowNumber,
          message: `Couldn't tell the first name from the last name in "${full}". Write it as "Last, First" in the file, or skip this row.`,
        });
        return;
      }
      firstName = split.first_name;
      lastName = split.last_name;
    } else {
      firstName = collapse(cell(firstCol));
      lastName = collapse(cell(lastCol));
    }

    if (firstName === "") {
      errors.push({ rowNumber, message: "Missing a first name." });
      return;
    }
    if (lastName === "") {
      errors.push({ rowNumber, message: "Missing a last name." });
      return;
    }

    const parent1Name = nullableCollapse(cell(parent1Col));
    const parent2Name = nullableCollapse(cell(parent2Col));
    const classGroups = splitClasses(cell(classCol));
    const carpool = nullableCollapse(cell(carpoolCol));

    const tooLong = [
      ["first name", firstName],
      ["last name", lastName],
      ...(parent1Name ? [["parent 1 name", parent1Name] as const] : []),
      ...(parent2Name ? [["parent 2 name", parent2Name] as const] : []),
      ...(carpool ? [["carpool name", carpool] as const] : []),
      ...classGroups.map((name) => ["class name", name] as const),
    ].find(([, value]) => value.length > MAX_NAME_LENGTH);
    if (tooLong) {
      errors.push({
        rowNumber,
        message: `That ${tooLong[0]} is too long (${tooLong[1].length} characters, limit ${MAX_NAME_LENGTH}). Check for a stray quotation mark on this row.`,
      });
      return;
    }

    const unknown = checkClasses
      ? classGroups.filter((name) => !knownClasses.has(name.toLowerCase()))
      : [];
    if (unknown.length > 0 && !createClasses) {
      errors.push({
        rowNumber,
        message: `There's no class called "${unknown[0]}". Add it under Classes first.`,
      });
      return;
    }

    const key = studentNameKey(firstName, lastName);
    const firstSeenAt = seenNames.get(key);
    if (firstSeenAt !== undefined) {
      errors.push({
        rowNumber,
        message: `Duplicate of row ${firstSeenAt} (${firstName} ${lastName}).`,
      });
      return;
    }
    seenNames.set(key, rowNumber);

    if (onRoster.has(key)) {
      alreadyOnRoster.push({ rowNumber, name: `${firstName} ${lastName}` });
      return;
    }

    // Only a row that will actually import contributes a new class.
    for (const name of unknown) {
      const classKey = name.toLowerCase();
      if (!newClasses.has(classKey)) newClasses.set(classKey, name);
    }

    toImport.push({
      first_name: firstName,
      last_name: lastName,
      aliases: splitAliases(cell(aliasCol)),
      class_groups: classGroups,
      carpool,
      parent1_name: parent1Name,
      parent2_name: parent2Name,
    });
    toImportRows.push(rowNumber);
  });

  const headerErrors: string[] = [];
  if (knownClasses.size + newClasses.size > MAX_CLASSES) {
    headerErrors.push(
      `This file would bring you to ${knownClasses.size + newClasses.size} classes, and the limit is ${MAX_CLASSES}. Check that the right column is chosen as Class.`,
    );
  }

  return {
    headerErrors,
    toImport: headerErrors.length > 0 ? [] : toImport,
    toImportRows: headerErrors.length > 0 ? [] : toImportRows,
    errors,
    blankRowsSkipped,
    titleRowsSkipped,
    totalDataRows: dataRows.length,
    unrecognizedHeaders,
    newClasses: [...newClasses.values()],
    alreadyOnRoster,
  };
}

/**
 * The whole pipeline on CSV (or tab/semicolon-separated) text, every guess
 * accepted. Unknown classes are row errors here, as they always were.
 */
export function parseRosterCsv(
  text: string,
  knownClassNames: readonly string[] = [],
  context: Omit<ImportContext, "knownClassNames"> = {},
): CsvImportReport {
  const { grid, unterminatedQuote } = textToGrid(text);
  if (unterminatedQuote) return emptyReport([UNTERMINATED_QUOTE_MESSAGE]);
  if (grid.length === 0) return emptyReport(["The file is empty."]);
  return buildImportReport(grid, detectLayout(grid), {
    ...context,
    knownClassNames,
  });
}
