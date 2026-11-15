import { describe, expect, it } from "vitest";

import { UNTERMINATED_QUOTE_MESSAGE } from "../csv-import";
import {
  type ImportFlowState,
  deriveReview,
  importFlowReducer,
  initialImportState,
  layoutIsConfident,
} from "./import-flow";
import { textToGrid } from "./read-source";

function loaded(text: string): ImportFlowState {
  return importFlowReducer(initialImportState, {
    type: "sourceLoaded",
    label: "Pasted cells",
    source: textToGrid(text),
  });
}

const FAMILY_CSV =
  "First Name,Last Name,Mother\nMiriam,Cohen,Sarah Cohen\nAaron,Cohen,Sarah Cohen\nNoa,Katz,Dina Katz\n";

const context = { knownClassNames: [], rosterNames: [], carpoolNames: [] };

describe("importFlowReducer", () => {
  it("sourceLoaded moves to columns with a layout", () => {
    const state = loaded(FAMILY_CSV);
    expect(state.step).toBe("columns");
    expect(state.layout?.assignments).toEqual([
      "first_name",
      "last_name",
      "parent1_name",
    ]);
    expect(state.sourceLabel).toBe("Pasted cells");
  });

  it("an unterminated quote sets sourceError and stays on choose", () => {
    const state = importFlowReducer(initialImportState, {
      type: "sourceLoaded",
      label: "x",
      source: textToGrid('a,b\n"x,1'),
    });
    expect(state.step).toBe("choose");
    expect(state.sourceError).toBe(UNTERMINATED_QUOTE_MESSAGE);
    expect(state.layout).toBeNull();
  });

  it("sourceFailed keeps the message on choose", () => {
    const state = importFlowReducer(initialImportState, {
      type: "sourceFailed",
      message: "nope",
    });
    expect(state).toMatchObject({ step: "choose", sourceError: "nope" });
  });

  it("refuses goTo review while the layout has problems", () => {
    const state = loaded(FAMILY_CSV);
    const broken = importFlowReducer(state, {
      type: "assign",
      column: 1,
      field: "ignore",
    });
    expect(importFlowReducer(broken, { type: "goTo", step: "review" })).toBe(
      broken,
    );
    expect(
      importFlowReducer(state, { type: "goTo", step: "review" }).step,
    ).toBe("review");
  });

  it("assign updates the layout and clears suggestion choices", () => {
    let state = loaded(FAMILY_CSV);
    state = importFlowReducer(state, {
      type: "toggleSuggestion",
      id: "a",
      recommendedIds: [],
    });
    state = importFlowReducer(state, {
      type: "assign",
      column: 2,
      field: "carpool",
    });
    expect(state.layout?.assignments[2]).toBe("carpool");
    expect(state.layout?.columns[2].field).toBe("carpool");
    expect(state.acceptedSuggestions).toEqual([]);
    expect(state.suggestionsTouched).toBe(false);
  });

  it("toggleSuggestion starts from the recommended ids on first touch", () => {
    let state = loaded(FAMILY_CSV);
    state = importFlowReducer(state, {
      type: "toggleSuggestion",
      id: "b",
      recommendedIds: ["a", "b"],
    });
    expect(state.acceptedSuggestions).toEqual(["a"]);
    state = importFlowReducer(state, {
      type: "toggleSuggestion",
      id: "b",
      recommendedIds: ["a", "b"],
    });
    expect(state.acceptedSuggestions.sort()).toEqual(["a", "b"]);
  });

  it("goTo done is refused without a result; importSucceeded reaches done", () => {
    const state = loaded(FAMILY_CSV);
    expect(importFlowReducer(state, { type: "goTo", step: "done" })).toBe(
      state,
    );
    const done = importFlowReducer(
      importFlowReducer(state, { type: "importStarted" }),
      {
        type: "importSucceeded",
        result: {
          created: 3,
          createdIds: [],
          createdClasses: [],
          createdCarpools: 1,
        },
      },
    );
    expect(done.step).toBe("done");
    expect(done.importing).toBe(false);
    expect(done.result?.created).toBe(3);
  });

  it("importFailed keeps the step and records the message", () => {
    const state = importFlowReducer(
      importFlowReducer(loaded(FAMILY_CSV), { type: "importStarted" }),
      { type: "importFailed", message: "boom" },
    );
    expect(state).toMatchObject({ importing: false, importError: "boom" });
  });

  it("reset returns to the initial state", () => {
    expect(importFlowReducer(loaded(FAMILY_CSV), { type: "reset" })).toEqual(
      initialImportState,
    );
  });
});

describe("layoutIsConfident", () => {
  it("is true for clean headings and false after ignoring a name column", () => {
    const state = loaded(FAMILY_CSV);
    expect(layoutIsConfident(state.layout!)).toBe(true);
  });
});

describe("deriveReview", () => {
  it("returns null before a layout exists", () => {
    expect(deriveReview(initialImportState, context)).toBeNull();
  });

  it("applies recommended suggestions by default and reflects them in carpools", () => {
    const review = deriveReview(loaded(FAMILY_CSV), context)!;
    expect(review.suggestions).toHaveLength(1);
    expect(review.suggestions[0].recommended).toBe(true);
    expect(review.students.map((s) => s.carpool)).toEqual([
      "Cohen family",
      "Cohen family",
      null,
    ]);
    expect(review.carpools).toEqual([
      { name: "Cohen family", memberCount: 2, isNew: true },
    ]);
  });

  it("respects the admin turning a suggestion off", () => {
    let state = loaded(FAMILY_CSV);
    const first = deriveReview(state, context)!;
    state = importFlowReducer(state, {
      type: "toggleSuggestion",
      id: first.suggestions[0].id,
      recommendedIds: ["" + first.suggestions[0].id],
    });
    const review = deriveReview(state, context)!;
    expect(review.students.every((s) => s.carpool === null)).toBe(true);
    expect(review.carpools).toEqual([]);
  });
});
