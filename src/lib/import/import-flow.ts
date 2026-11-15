/**
 * The import screen's state machine: Choose -> Check columns -> Review ->
 * Done. Pure, so every transition is unit-tested without rendering, the same
 * way `announce-reducer.ts` keeps `/announce` honest.
 *
 * Derived data (the validation report, suggestions, carpool summary) is not
 * stored here: `deriveReview` computes it from state, so it can never drift
 * from the layout the admin is looking at.
 */

import {
  type CsvImportReport,
  type CsvImportStudent,
  UNTERMINATED_QUOTE_MESSAGE,
  buildImportReport,
} from "../csv-import";
import {
  type ColumnGuess,
  type DetectedLayout,
  detectLayout,
  layoutProblems,
} from "./detect-columns";
import type { ColumnAssignment } from "./fields";
import type { SourceGrid } from "./read-source";
import type { NameOrder } from "./split-name";
import {
  type CarpoolSuggestion,
  type CarpoolSummary,
  applySuggestions,
  suggestSiblingCarpools,
  summarizeCarpools,
} from "./suggest-carpools";

export type ImportStep = "choose" | "columns" | "review" | "done";

export const STEP_ORDER: readonly ImportStep[] = [
  "choose",
  "columns",
  "review",
  "done",
];

export const STEP_LABELS: Record<ImportStep, string> = {
  choose: "Choose",
  columns: "Check columns",
  review: "Review",
  done: "Import",
};

export interface ImportResult {
  created: number;
  createdIds: string[];
  createdClasses: string[];
  createdCarpools: number;
}

export interface ImportFlowState {
  step: ImportStep;
  /** "Roster.xlsx" or "Pasted cells", for the header line. */
  sourceLabel: string | null;
  /** e.g. "Read the sheet “Students” (1 of 3)". */
  sourceNote: string | null;
  sourceError: string | null;
  grid: string[][];
  layout: DetectedLayout | null;
  /** Suggestion ids the admin has ticked (or untouched recommended ones). */
  acceptedSuggestions: string[];
  /** Whether the admin has touched any suggestion checkbox yet. */
  suggestionsTouched: boolean;
  importing: boolean;
  importError: string | null;
  result: ImportResult | null;
}

export const initialImportState: ImportFlowState = {
  step: "choose",
  sourceLabel: null,
  sourceNote: null,
  sourceError: null,
  grid: [],
  layout: null,
  acceptedSuggestions: [],
  suggestionsTouched: false,
  importing: false,
  importError: null,
  result: null,
};

export type ImportAction =
  | { type: "sourceLoaded"; label: string; source: SourceGrid }
  | { type: "sourceFailed"; message: string }
  | { type: "assign"; column: number; field: ColumnAssignment }
  | { type: "setNameOrder"; order: NameOrder }
  | { type: "setHeaderRow"; row: number }
  | { type: "goTo"; step: ImportStep }
  | { type: "toggleSuggestion"; id: string; recommendedIds: string[] }
  | { type: "setAllSuggestions"; ids: string[] }
  | { type: "importStarted" }
  | { type: "importFailed"; message: string }
  | { type: "importSucceeded"; result: ImportResult }
  | { type: "reset" };

function relabel(layout: DetectedLayout): DetectedLayout {
  const columns: ColumnGuess[] = layout.columns.map((column) => ({
    ...column,
    field: layout.assignments[column.index] ?? "ignore",
  }));
  return { ...layout, columns };
}

/** True when the column step can be skipped past without anyone looking. */
export function layoutIsConfident(layout: DetectedLayout): boolean {
  return (
    layoutProblems(layout.assignments).length === 0 &&
    layout.columns.every(
      (column) => column.field === "ignore" || column.confidence === "high",
    )
  );
}

export function importFlowReducer(
  state: ImportFlowState,
  action: ImportAction,
): ImportFlowState {
  switch (action.type) {
    case "sourceLoaded": {
      const { source, label } = action;
      if (source.unterminatedQuote) {
        return {
          ...initialImportState,
          sourceLabel: label,
          sourceError: UNTERMINATED_QUOTE_MESSAGE,
        };
      }
      const layout = detectLayout(source.grid);
      const sheetNote =
        source.sheetName && (source.sheetCount ?? 1) > 1
          ? `Read the sheet "${source.sheetName}", the one with the most rows (${source.sheetCount} sheets in the file).`
          : null;
      return {
        ...initialImportState,
        step: "columns",
        sourceLabel: label,
        sourceNote: sheetNote,
        grid: source.grid,
        layout,
      };
    }
    case "sourceFailed":
      return { ...initialImportState, sourceError: action.message };
    case "assign": {
      if (!state.layout) return state;
      const assignments = [...state.layout.assignments];
      assignments[action.column] = action.field;
      return {
        ...state,
        layout: relabel({ ...state.layout, assignments }),
        // A changed layout can change who the suggestions point at.
        acceptedSuggestions: [],
        suggestionsTouched: false,
      };
    }
    case "setNameOrder":
      if (!state.layout) return state;
      return {
        ...state,
        layout: { ...state.layout, nameOrder: action.order },
        acceptedSuggestions: [],
        suggestionsTouched: false,
      };
    case "setHeaderRow":
      return {
        ...state,
        layout: detectLayout(state.grid, action.row),
        acceptedSuggestions: [],
        suggestionsTouched: false,
      };
    case "goTo": {
      // Never forward past a step that isn't ready.
      if (action.step === "choose") return { ...state, step: "choose" };
      if (!state.layout) return state;
      if (
        action.step === "review" &&
        layoutProblems(state.layout.assignments).length > 0
      ) {
        return state;
      }
      if (action.step === "done" && !state.result) return state;
      return { ...state, step: action.step, importError: null };
    }
    case "toggleSuggestion": {
      // The first touch starts from the recommended set the screen showed.
      const current = new Set(
        state.suggestionsTouched
          ? state.acceptedSuggestions
          : action.recommendedIds,
      );
      if (current.has(action.id)) current.delete(action.id);
      else current.add(action.id);
      return {
        ...state,
        acceptedSuggestions: [...current],
        suggestionsTouched: true,
      };
    }
    case "setAllSuggestions":
      return {
        ...state,
        acceptedSuggestions: action.ids,
        suggestionsTouched: true,
      };
    case "importStarted":
      return { ...state, importing: true, importError: null };
    case "importFailed":
      return { ...state, importing: false, importError: action.message };
    case "importSucceeded":
      return {
        ...state,
        importing: false,
        importError: null,
        result: action.result,
        step: "done",
      };
    case "reset":
      return initialImportState;
  }
}

export interface ReviewContext {
  knownClassNames: readonly string[];
  rosterNames: readonly { first_name: string; last_name: string }[];
  carpoolNames: readonly string[];
}

export interface ReviewModel {
  report: CsvImportReport;
  suggestions: CarpoolSuggestion[];
  acceptedIds: ReadonlySet<string>;
  /** What will actually be sent: report rows with accepted carpools applied. */
  students: CsvImportStudent[];
  carpools: CarpoolSummary[];
}

export function deriveReview(
  state: ImportFlowState,
  context: ReviewContext,
): ReviewModel | null {
  if (!state.layout) return null;
  const report = buildImportReport(state.grid, state.layout, {
    knownClassNames: context.knownClassNames,
    unknownClasses: "create",
    rosterNames: context.rosterNames,
  });
  const typedCarpools = report.toImport
    .map((student) => student.carpool)
    .filter((name): name is string => name !== null);
  const suggestions = suggestSiblingCarpools(report.toImport, [
    ...context.carpoolNames,
    ...typedCarpools,
  ]);
  const acceptedIds = new Set(
    state.suggestionsTouched
      ? state.acceptedSuggestions
      : suggestions.filter((s) => s.recommended).map((s) => s.id),
  );
  const applied = applySuggestions(report.toImport, suggestions, acceptedIds);
  const carpools = summarizeCarpools(applied, context.carpoolNames);
  // "cohen family " and "Cohen family" are one carpool on the server; show
  // and send the one spelling the summary settled on.
  const canonical = new Map(
    carpools.map((c) => [
      c.name.trim().replace(/\s+/g, " ").toLowerCase(),
      c.name,
    ]),
  );
  const students = applied.map((student) =>
    student.carpool === null
      ? student
      : {
          ...student,
          carpool:
            canonical.get(
              student.carpool.trim().replace(/\s+/g, " ").toLowerCase(),
            ) ?? student.carpool,
        },
  );
  return { report, suggestions, acceptedIds, students, carpools };
}
