/**
 * Works out where a spreadsheet's headings are and what each column holds.
 *
 * Pure: a grid of strings in, a proposed layout out. Nothing here is final --
 * the admin sees every guess on the mapping screen and can change it, so the
 * job is to be right most of the time and honest about when it is unsure.
 */

import {
  type ColumnAssignment,
  FIELD_LABELS,
  HEADER_ALIASES,
  type ImportField,
  LOOSE_HINTS,
  normalizeHeading,
} from "./fields";
import type { NameOrder } from "./split-name";

export type Confidence = "high" | "low" | "none";

export interface ColumnGuess {
  index: number;
  /** The heading as written, or "Column C" when there is none. */
  heading: string;
  /** Up to three non-empty values from below the heading row. */
  samples: string[];
  field: ColumnAssignment;
  confidence: Confidence;
}

export interface ImportLayout {
  /** Row index of the headings in the grid; -1 means the file has none. */
  headerRowIndex: number;
  /** One assignment per column, by column index. */
  assignments: ColumnAssignment[];
  nameOrder: NameOrder;
}

export interface DetectedLayout extends ImportLayout {
  columns: ColumnGuess[];
}

/** How far down a title block can push the real headings. */
export const HEADER_SEARCH_ROWS = 10;

const SAMPLE_COUNT = 3;

const CONTACT_WORDS = new Set([
  "email",
  "e",
  "mail",
  "phone",
  "cell",
  "mobile",
  "tel",
  "address",
  "street",
  "city",
  "zip",
  "id",
  "number",
  "no",
  "dob",
  "birth",
  "birthday",
  "date",
  "age",
  "gender",
  "allergies",
]);

/** "A", "B", ... "Z", "AA" -- the letters a spreadsheet shows. */
export function columnLetter(index: number): string {
  let n = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letters;
}

interface HeadingMatch {
  field: ImportField;
  confidence: "high" | "low";
  /** Lower wins when two columns claim one field. */
  priority: number;
  /** For a combined "Last name, First name" heading. */
  nameOrder?: NameOrder;
}

/** What one heading most likely means, or null. */
export function matchHeading(raw: string): HeadingMatch | null {
  const heading = normalizeHeading(raw);
  if (heading === "") return null;

  for (const field of Object.keys(HEADER_ALIASES) as ImportField[]) {
    const priority = HEADER_ALIASES[field].indexOf(heading);
    if (priority !== -1) return { field, confidence: "high", priority };
  }

  const words = heading.split(" ");
  // "Last Name, First Name" / "First & Last" is one column holding both.
  const firstAt = words.indexOf("first");
  const lastAt = words.findIndex((w) => w === "last" || w === "surname");
  if (firstAt !== -1 && lastAt !== -1) {
    return {
      field: "full_name",
      confidence: "high",
      priority: 0,
      nameOrder: lastAt < firstAt ? "last-first" : "first-last",
    };
  }

  // "Parent email", "Teacher phone", "Date of birth": contact and record
  // columns mention a field's word without holding that field.
  if (words.some((word) => CONTACT_WORDS.has(word))) return null;

  for (const hint of LOOSE_HINTS) {
    if (hint.words.some((word) => words.includes(word))) {
      return { field: hint.field, confidence: "low", priority: 1000 };
    }
  }
  return null;
}

function rowScore(row: readonly string[]): number {
  let score = 0;
  let hasName = false;
  for (const cell of row) {
    const match = matchHeading(cell);
    if (!match) continue;
    score += match.confidence === "high" ? 2 : 1;
    if (
      match.field === "first_name" ||
      match.field === "last_name" ||
      match.field === "full_name"
    ) {
      hasName = true;
    }
  }
  return hasName ? score + 3 : score;
}

/**
 * The row among the first few that looks most like headings. Title rows
 * ("Spring roster 2026") and blank rows above it score nothing.
 * @returns -1 when no row looks like headings at all.
 */
export function findHeaderRow(grid: readonly (readonly string[])[]): number {
  let bestIndex = -1;
  let bestScore = 0;
  const limit = Math.min(grid.length, HEADER_SEARCH_ROWS);
  for (let index = 0; index < limit; index++) {
    const score = rowScore(grid[index]);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return bestIndex;
}

export function gridWidth(grid: readonly (readonly string[])[]): number {
  return grid.reduce((max, row) => Math.max(max, row.length), 0);
}

function samplesFor(
  grid: readonly (readonly string[])[],
  column: number,
  headerRowIndex: number,
): string[] {
  const samples: string[] = [];
  for (let r = headerRowIndex + 1; r < grid.length; r++) {
    const value = (grid[r][column] ?? "").trim();
    if (value !== "") samples.push(value);
    if (samples.length === SAMPLE_COUNT) break;
  }
  return samples;
}

/**
 * Proposes a layout. Pass `forcedHeaderRow` when the admin has said where the
 * headings are (or -1 for "there are none"); otherwise it is detected.
 */
export function detectLayout(
  grid: readonly (readonly string[])[],
  forcedHeaderRow?: number,
): DetectedLayout {
  const headerRowIndex =
    forcedHeaderRow !== undefined ? forcedHeaderRow : findHeaderRow(grid);
  const width = gridWidth(grid);
  const headerRow = headerRowIndex >= 0 ? (grid[headerRowIndex] ?? []) : [];

  const matches = Array.from({ length: width }, (_, index) =>
    matchHeading(headerRow[index] ?? ""),
  );

  const assignments: ColumnAssignment[] = Array(width).fill("ignore");
  const confidence: Confidence[] = Array(width).fill("none");
  let nameOrder: NameOrder = "first-last";

  // Settle strongest claims first so "last_name" beats "last", and an exact
  // heading always beats a hint, wherever the columns sit.
  const order = matches
    .map((match, index) => ({ match, index }))
    .filter(
      (entry): entry is { match: HeadingMatch; index: number } =>
        entry.match !== null,
    )
    .sort(
      (a, b) =>
        (a.match.confidence === b.match.confidence
          ? 0
          : a.match.confidence === "high"
            ? -1
            : 1) ||
        a.match.priority - b.match.priority ||
        a.index - b.index,
    );

  const taken = new Set<ColumnAssignment>();
  for (const { match, index } of order) {
    let field: ImportField = match.field;
    // A second parent column ("Mother" then "Father", or two "Guardian"s) is
    // parent 2, not a clash.
    if (field === "parent1_name" && taken.has("parent1_name")) {
      field = "parent2_name";
    }
    if (taken.has(field)) continue;
    taken.add(field);
    assignments[index] = field;
    confidence[index] = match.confidence;
    if (field === "full_name" && match.nameOrder) nameOrder = match.nameOrder;
  }

  // With separate first and last columns, a "Name" column is redundant (often
  // a display name); importing both would only invite a conflict.
  if (taken.has("first_name") && taken.has("last_name")) {
    const full = assignments.indexOf("full_name");
    if (full !== -1) {
      assignments[full] = "ignore";
      confidence[full] = "none";
    }
  }

  const columns: ColumnGuess[] = Array.from({ length: width }, (_, index) => {
    const written = (headerRow[index] ?? "").trim();
    return {
      index,
      heading: written !== "" ? written : `Column ${columnLetter(index)}`,
      samples: samplesFor(grid, index, headerRowIndex),
      field: assignments[index],
      confidence: confidence[index],
    };
  });

  return { headerRowIndex, assignments, nameOrder, columns };
}

/** True when the layout has a usable source for every student's name. */
export function hasNameColumns(assignments: readonly ColumnAssignment[]) {
  return (
    (assignments.includes("first_name") && assignments.includes("last_name")) ||
    assignments.includes("full_name")
  );
}

/**
 * What still blocks the import, each as one sentence a staff member can act
 * on. Empty means the layout is usable.
 */
export function layoutProblems(
  assignments: readonly ColumnAssignment[],
): string[] {
  const problems: string[] = [];

  const byField = new Map<ColumnAssignment, number[]>();
  assignments.forEach((field, index) => {
    if (field === "ignore") return;
    byField.set(field, [...(byField.get(field) ?? []), index]);
  });
  for (const [field, indexes] of byField) {
    if (indexes.length > 1) {
      const letters = indexes.map(columnLetter).join(" and ");
      problems.push(
        `"${FIELD_LABELS[field]}" is chosen for columns ${letters}. Pick one and set the other to "Don't import".`,
      );
    }
  }

  if (!hasNameColumns(assignments)) {
    const hasFirst = assignments.includes("first_name");
    const hasLast = assignments.includes("last_name");
    problems.unshift(
      hasFirst && !hasLast
        ? "Choose which column holds the last name (or one column with the full name)."
        : hasLast && !hasFirst
          ? "Choose which column holds the first name (or one column with the full name)."
          : "Choose which column holds the students' names: a first name and a last name column, or one full name column.",
    );
  }

  return problems;
}
