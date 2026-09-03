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
  "first_name" | "last_name" | "aliases" | "grade" | "class_group";

export interface CsvImportStudent {
  first_name: string;
  last_name: string;
  aliases: string[];
  grade: string | null;
  class_group: string | null;
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
  grade: ["grade", "grade level"],
  class_group: ["class_group", "class", "classroom", "class group", "homeroom"],
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

function mapHeaders(headerRow: string[]): Partial<Record<CsvField, number>> {
  const normalized = headerRow.map(normalizeHeader);
  const result: Partial<Record<CsvField, number>> = {};

  // Walk the ALIASES in priority order and take the first that the file has,
  // rather than walking the FILE and taking the first column matching any
  // alias. The latter let "last" beat "last_name" purely by appearing to its
  // left, which silently bound every surname to the wrong column.
  for (const field of Object.keys(HEADER_ALIASES) as CsvField[]) {
    for (const alias of HEADER_ALIASES[field]) {
      const index = normalized.indexOf(alias);
      if (index !== -1) {
        result[field] = index;
        break;
      }
    }
  }

  return result;
}

/** Aliases split on comma or semicolon, so a quoted "Kohen, Cohn" cell and a semicolon-delimited one both work. */
function splitAliases(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

function nullableTrim(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

export function parseRosterCsv(text: string): CsvImportReport {
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
    };
  }

  if (rows.length === 0) {
    return {
      headerErrors: ["The file is empty."],
      toImport: [],
      errors: [],
      blankRowsSkipped: 0,
      totalDataRows: 0,
    };
  }

  const [headerRow, ...dataRows] = rows;
  const columnIndex = mapHeaders(headerRow);

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
    };
  }

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

    const tooLong = [
      ["first name", firstName],
      ["last name", lastName],
    ].find(([, value]) => value.length > MAX_NAME_LENGTH);
    if (tooLong) {
      errors.push({
        rowNumber,
        message: `That ${tooLong[0]} is too long (${tooLong[1].length} characters, limit ${MAX_NAME_LENGTH}). Check for a stray quotation mark on this row.`,
      });
      return;
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
      grade:
        columnIndex.grade !== undefined
          ? nullableTrim(padded[columnIndex.grade])
          : null,
      class_group:
        columnIndex.class_group !== undefined
          ? nullableTrim(padded[columnIndex.class_group])
          : null,
    });
  });

  return {
    headerErrors: [],
    toImport,
    errors,
    blankRowsSkipped,
    totalDataRows: dataRows.length,
  };
}
