/**
 * Turns whatever the school has -- an Excel workbook, a CSV, a semicolon
 * "CSV" from European Excel, a paste out of Google Sheets -- into one grid of
 * strings. Everything after this step works on the grid and never needs to
 * know where it came from.
 */

import { sniffDelimiter, tokenizeCsv } from "./csv-tokenize";

export interface SourceGrid {
  grid: string[][];
  /** See `TokenizedCsv.unterminatedQuote`: such a grid must not be imported. */
  unterminatedQuote: boolean;
  /** For a workbook: the sheet that was read, and how many there were. */
  sheetName?: string;
  sheetCount?: number;
}

export type SourceResult =
  { ok: true; source: SourceGrid } | { ok: false; message: string };

/**
 * An AI tool's reply usually wraps the CSV in a ``` code block, often with a
 * sentence before it. Keep only what is inside the first fence.
 */
export function stripCodeFence(text: string): string {
  const match = /```[^\n]*\n([\s\S]*?)(?:\n```|$)/.exec(text);
  return match ? match[1] : text;
}

/** Pasted text or a text file's contents -> grid, with the delimiter sniffed. */
export function textToGrid(text: string): SourceGrid {
  const unfenced = stripCodeFence(text);
  const stripped =
    unfenced.charCodeAt(0) === 0xfeff ? unfenced.slice(1) : unfenced;
  const { rows, unterminatedQuote } = tokenizeCsv(
    stripped,
    sniffDelimiter(stripped),
  );
  return { grid: rows, unterminatedQuote };
}

/** One spreadsheet cell, whatever type the reader gave it, as text. */
export function cellToString(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) {
    return Number.isNaN(cell.getTime()) ? "" : cell.toISOString().slice(0, 10);
  }
  if (typeof cell === "string") return cell;
  if (typeof cell === "number" || typeof cell === "boolean") {
    return String(cell);
  }
  return "";
}

function nonEmptyRows(data: readonly (readonly unknown[])[]): number {
  return data.filter((row) => row.some((cell) => cellToString(cell).trim()))
    .length;
}

/**
 * A workbook's sheets -> the one to import: the sheet with the most filled
 * rows. A roster workbook often opens on a cover or instructions sheet.
 */
export function pickSheet(
  sheets: readonly { sheet: string; data: readonly (readonly unknown[])[] }[],
): SourceGrid {
  let best = sheets[0];
  let bestRows = best ? nonEmptyRows(best.data) : 0;
  for (const candidate of sheets.slice(1)) {
    const rows = nonEmptyRows(candidate.data);
    if (rows > bestRows) {
      best = candidate;
      bestRows = rows;
    }
  }
  return {
    grid: best ? best.data.map((row) => row.map(cellToString)) : [],
    unterminatedQuote: false,
    sheetName: best?.sheet,
    sheetCount: sheets.length,
  };
}

export type SourceKind = "text" | "xlsx" | "xls" | "numbers" | "unsupported";

const TEXT_EXTENSIONS = new Set(["csv", "tsv", "txt", "tab", "psv"]);

export function sourceKindFor(fileName: string, mimeType = ""): SourceKind {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "xlsx" || ext === "xlsm") return "xlsx";
  if (ext === "xls") return "xls";
  if (ext === "numbers") return "numbers";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  if (mimeType.startsWith("text/")) return "text";
  return "unsupported";
}

/** Each sentence says what to do next, not just what went wrong. */
export const SOURCE_MESSAGES = {
  xls: "This is an older Excel file (.xls). Open it in Excel, choose Save As, and pick Excel Workbook (.xlsx) — or copy the cells and paste them instead.",
  numbers:
    "This is a Numbers file. In Numbers choose File, Export To, Excel or CSV — or copy the cells and paste them instead.",
  unsupported:
    "We can read Excel (.xlsx), CSV and text files. Save it as one of those, or copy the cells from your spreadsheet and paste them instead.",
  unreadable:
    "We couldn't read that spreadsheet. Try saving it again as .xlsx or CSV, or copy the cells and paste them instead.",
  empty: "That file has no rows in it.",
  tooBig:
    "That file is too big to be a student list (over 5 MB). Check it's the right file, or copy just the roster cells and paste them instead.",
} as const;

/** Far past any school roster (1,000 rows is a few hundred KB). */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** The accept list for the file input, kept beside the reader it describes. */
export const FILE_ACCEPT =
  ".csv,.tsv,.txt,.xlsx,.xlsm,.xls,.numbers,text/csv,text/plain,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Reads a picked file. The Excel reader is loaded only when an Excel file is
 * picked, so it never weighs down any other screen.
 */
export async function readFileToGrid(file: File): Promise<SourceResult> {
  // Parsing happens on the main thread; a huge workbook would freeze the tab
  // long before the server's row cap could say no.
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, message: SOURCE_MESSAGES.tooBig };
  }
  const kind = sourceKindFor(file.name, file.type);
  if (kind === "xls" || kind === "numbers" || kind === "unsupported") {
    return { ok: false, message: SOURCE_MESSAGES[kind] };
  }

  let source: SourceGrid;
  if (kind === "xlsx") {
    try {
      const { default: readXlsxFile } = await import("read-excel-file/browser");
      source = pickSheet(await readXlsxFile(file));
    } catch {
      return { ok: false, message: SOURCE_MESSAGES.unreadable };
    }
  } else {
    source = textToGrid(await file.text());
  }

  if (!source.grid.some((row) => row.some((cell) => cell.trim() !== ""))) {
    return { ok: false, message: SOURCE_MESSAGES.empty };
  }
  return { ok: true, source };
}
