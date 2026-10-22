/**
 * Turns a roster CSV into a validation report, never a crash.
 *
 * Pure logic, no DOM and no network, so it runs the same in a unit test and in
 * the browser after a `<input type="file">` read. Nothing here writes
 * anywhere -- `/admin` shows this report and only calls `roster-import` after
 * a person has looked at it and confirmed.
 *
 * The parser is hand-rolled rather than a dependency for the same reason
 * `_shared/resolver.ts` is: a few hundred lines of well-tested state machine
 * is a smaller, more auditable surface than a new package for one file format,
 * and RFC 4180 quoting is not a large rule set to get right once.
 */

export type CsvField =
  | "first_name"
  | "last_name"
  | "aliases"
  | "class_groups"
  | "carpool"
  | "parent1_name"
  | "parent2_name";

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
  /** 1-based, counting the header as row 1 -- the number a spreadsheet shows. */
  rowNumber: number;
  message: string;
}

export interface CsvImportReport {
  /** Non-empty only when the file cannot be read at all (bad or missing header). */
  headerErrors: string[];
  /** What will actually be written if the person confirms. */
  toImport: CsvImportStudent[];
  /** Per-row problems, each skipped rather than aborting the whole file. */
  errors: CsvImportError[];
  /** Rows that were empty or whitespace-only. Not an error -- just not data. */
  blankRowsSkipped: number;
  /** Data rows in the file, header excluded. errors + blankRowsSkipped + toImport.length <= this (duplicates and column-count mismatches also subtract). */
  totalDataRows: number;
  /**
   * Header cells that did not match any known field's aliases, exactly as
   * written in the file. Surfaced rather than silently dropped: a column the
   * importer doesn't recognise used to vanish with no signal at all, which is
   * exactly how a school's "Grade" column full of class names went missing
   * with no error anywhere.
   */
  unrecognizedHeaders: string[];
}

/**
 * Header names a school's own export is likely to use, matched
 * case-insensitively after trimming. `first_name` and `last_name` are the
 * only required columns; the rest default to empty/null when absent.
 */
const HEADER_ALIASES: Record<CsvField, string[]> = {
  first_name: ["first_name", "firstname", "first name", "first"],
  last_name: ["last_name", "lastname", "last name", "last", "surname"],
  aliases: [
    "aliases",
    "alias",
    "alternate spellings",
    "alt names",
    "nicknames",
  ],
  // "grade" is here even though the app dropped grade as a concept (see the
  // drop_grade migration): a school's own export still calls this column
  // "Grade" and puts class names in it (e.g. "EC Hummingbirds"), and that
  // real file is what class_groups needs to receive. The cell may list several
  // classes separated by semicolons (see splitClasses).
  class_groups: [
    "class_groups",
    "classes",
    "class_group",
    "class",
    "classroom",
    "class group",
    "homeroom",
    "grade",
  ],
  carpool: ["carpool", "carpool name", "car pool", "ride group", "ride"],
  parent1_name: [
    "parent1_name",
    "parent 1",
    "parent1",
    "parent 1 name",
    "mother",
    "guardian 1",
  ],
  parent2_name: [
    "parent2_name",
    "parent 2",
    "parent2",
    "parent 2 name",
    "father",
    "guardian 2",
  ],
};

const REQUIRED_FIELDS: CsvField[] = ["first_name", "last_name"];

/**
 * Nothing between a CSV file and Postgres bounded a name, and the columns are
 * bare `text`. An unbounded surname does not just sit there: keyterms.ts pushes
 * it into the Deepgram keyterm list, which plausibly breaks token minting for
 * the whole school, and /display renders it as one enormous tile.
 *
 * 120 is far past any real name and far short of a problem.
 */
export const MAX_NAME_LENGTH = 120;

/**
 * RFC 4180 tokenizer: quoted fields, `""` as an escaped quote, commas and
 * newlines inside quotes taken literally, and either `\r\n` or `\n` as a row
 * terminator outside of quotes. A trailing terminator at end-of-file does not
 * manufacture a phantom empty row.
 */
interface TokenizedCsv {
  rows: string[][];
  /**
   * True when end-of-file arrived with a quoted field still open. Everything
   * after the stray quote was absorbed into that one field, so the rows are
   * not what the file's author wrote and must not be imported.
   */
  unterminatedQuote: boolean;
}

function tokenizeCsv(text: string): TokenizedCsv {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < len) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      pushField();
      i++;
      continue;
    }
    if (ch === "\r") {
      if (text[i + 1] === "\n") {
        pushRow();
        i += 2;
        continue;
      }
      pushRow();
      i++;
      continue;
    }
    if (ch === "\n") {
      pushRow();
      i++;
      continue;
    }

    field += ch;
    i++;
  }

  // Only flush a final row if something was actually read since the last
  // terminator -- otherwise a trailing newline would add an empty row nobody
  // typed.
  if (field !== "" || row.length > 0) {
    pushRow();
  }

  return { rows, unterminatedQuote: inQuotes };
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase();
}

interface HeaderMap {
  columnIndex: Partial<Record<CsvField, number>>;
  /** Non-empty header cells that matched no field's aliases, as written. */
  unrecognizedHeaders: string[];
}

function mapHeaders(headerRow: string[]): HeaderMap {
  const normalized = headerRow.map(normalizeHeader);
  const columnIndex: Partial<Record<CsvField, number>> = {};

  // Walk the ALIASES in priority order and take the first that the file has,
  // rather than walking the FILE and taking the first column matching any
  // alias. The latter let "last" beat "last_name" purely by appearing to its
  // left, which silently bound every surname to the wrong column.
  for (const field of Object.keys(HEADER_ALIASES) as CsvField[]) {
    for (const alias of HEADER_ALIASES[field]) {
      const index = normalized.indexOf(alias);
      if (index !== -1) {
        columnIndex[field] = index;
        break;
      }
    }
  }

  const claimedIndexes = new Set(Object.values(columnIndex));
  const unrecognizedHeaders = headerRow.filter(
    (cell, index) => cell.trim() !== "" && !claimedIndexes.has(index),
  );

  return { columnIndex, unrecognizedHeaders };
}

/** Aliases split on comma or semicolon, so a quoted "Kohen, Cohn" cell and a semicolon-delimited one both work. */
function splitAliases(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((entry) => entry.trim())
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
    const name = segment.trim();
    if (name === "") continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    classes.push(name);
  }
  return classes;
}

function nullableTrim(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * @param knownClassNames the live class names. When non-empty, a class in the
 *   file that matches none of them (case-insensitively) rejects that row rather
 *   than silently creating or dropping a class. Empty skips the check.
 */
export function parseRosterCsv(
  text: string,
  knownClassNames: readonly string[] = [],
): CsvImportReport {
  const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const { rows, unterminatedQuote } = tokenizeCsv(stripped);

  if (unterminatedQuote) {
    return {
      headerErrors: [
        "A quotation mark in this file is never closed, so the rows after it cannot be read. Fix the quotation mark and export the file again.",
      ],
      toImport: [],
      errors: [],
      blankRowsSkipped: 0,
      totalDataRows: 0,
      unrecognizedHeaders: [],
    };
  }

  if (rows.length === 0) {
    return {
      headerErrors: ["The file is empty."],
      toImport: [],
      errors: [],
      blankRowsSkipped: 0,
      totalDataRows: 0,
      unrecognizedHeaders: [],
    };
  }

  const [headerRow, ...dataRows] = rows;
  const { columnIndex, unrecognizedHeaders } = mapHeaders(headerRow);

  const headerErrors = REQUIRED_FIELDS.filter(
    (field) => columnIndex[field] === undefined,
  ).map(
    (field) =>
      `Missing required column: ${field} (or "${field === "first_name" ? "First Name" : "Last Name"}").`,
  );

  if (headerErrors.length > 0) {
    return {
      headerErrors,
      toImport: [],
      errors: [],
      blankRowsSkipped: 0,
      totalDataRows: dataRows.length,
      unrecognizedHeaders: [],
    };
  }

  const knownClassKeys = new Set(
    knownClassNames.map((name) => name.trim().toLowerCase()),
  );
  const expectedColumns = headerRow.length;
  const toImport: CsvImportStudent[] = [];
  const errors: CsvImportError[] = [];
  let blankRowsSkipped = 0;
  // Full name (case-folded) -> the row number it first appeared on, so a
  // later duplicate can point back to it.
  const seenNames = new Map<string, number>();

  dataRows.forEach((fields, offset) => {
    const rowNumber = offset + 2; // the header occupies row 1

    if (fields.every((field) => field.trim() === "")) {
      blankRowsSkipped++;
      return;
    }

    // A row with FEWER columns than the header is almost always an exporter
    // dropping trailing empties, so pad it. More columns than the header is a
    // real structural problem -- the values no longer line up with the names.
    if (fields.length > expectedColumns) {
      errors.push({
        rowNumber,
        message: `Expected ${expectedColumns} columns (matching the header) but this row has ${fields.length}.`,
      });
      return;
    }
    const padded =
      fields.length === expectedColumns
        ? fields
        : [
            ...fields,
            ...Array<string>(expectedColumns - fields.length).fill(""),
          ];

    const firstName = (padded[columnIndex.first_name!] ?? "").trim();
    const lastName = (padded[columnIndex.last_name!] ?? "").trim();

    if (firstName === "") {
      errors.push({ rowNumber, message: "Missing a first name." });
      return;
    }
    if (lastName === "") {
      errors.push({ rowNumber, message: "Missing a last name." });
      return;
    }

    const parent1Name =
      columnIndex.parent1_name !== undefined
        ? nullableTrim(padded[columnIndex.parent1_name])
        : null;
    const parent2Name =
      columnIndex.parent2_name !== undefined
        ? nullableTrim(padded[columnIndex.parent2_name])
        : null;

    const tooLong = [
      ["first name", firstName],
      ["last name", lastName],
      ...(parent1Name ? [["parent 1 name", parent1Name] as const] : []),
      ...(parent2Name ? [["parent 2 name", parent2Name] as const] : []),
    ].find(([, value]) => value.length > MAX_NAME_LENGTH);
    if (tooLong) {
      errors.push({
        rowNumber,
        message: `That ${tooLong[0]} is too long (${tooLong[1].length} characters, limit ${MAX_NAME_LENGTH}). Check for a stray quotation mark on this row.`,
      });
      return;
    }

    const classGroups =
      columnIndex.class_groups !== undefined
        ? splitClasses(padded[columnIndex.class_groups] ?? "")
        : [];
    if (knownClassKeys.size > 0) {
      const unknown = classGroups.find(
        (name) => !knownClassKeys.has(name.toLowerCase()),
      );
      if (unknown !== undefined) {
        errors.push({
          rowNumber,
          message: `Row ${rowNumber}: there's no class called "${unknown}". Add it under Classes first.`,
        });
        return;
      }
    }

    const key = `${firstName.toLowerCase()} ${lastName.toLowerCase()}`;
    const firstSeenAt = seenNames.get(key);
    if (firstSeenAt !== undefined) {
      errors.push({
        rowNumber,
        message: `Duplicate of row ${firstSeenAt} (${firstName} ${lastName}).`,
      });
      return;
    }
    seenNames.set(key, rowNumber);

    toImport.push({
      first_name: firstName,
      last_name: lastName,
      aliases:
        columnIndex.aliases !== undefined
          ? splitAliases(padded[columnIndex.aliases] ?? "")
          : [],
      class_groups: classGroups,
      carpool:
        columnIndex.carpool !== undefined
          ? nullableTrim(padded[columnIndex.carpool])
          : null,
      parent1_name: parent1Name,
      parent2_name: parent2Name,
    });
  });

  return {
    headerErrors: [],
    toImport,
    errors,
    blankRowsSkipped,
    totalDataRows: dataRows.length,
    unrecognizedHeaders,
  };
}
