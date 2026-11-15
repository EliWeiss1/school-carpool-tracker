/**
 * Regressions for the careful-review findings on the flexible importer.
 * Each test reproduces the original failure.
 */
import { describe, expect, it } from "vitest";

import { type CsvImportStudent, buildImportReport } from "../csv-import";
import { detectLayout } from "./detect-columns";
import { deriveReview, initialImportState } from "./import-flow";
import { suggestSiblingCarpools } from "./suggest-carpools";

function student(
  first: string,
  last: string,
  parent1: string | null = null,
  carpool: string | null = null,
): CsvImportStudent {
  return {
    first_name: first,
    last_name: last,
    aliases: [],
    class_groups: [],
    carpool,
    parent1_name: parent1,
    parent2_name: null,
  };
}

describe("a brand-new school with no classes yet", () => {
  it("collects every class in the file as new instead of skipping the check", () => {
    const grid = [
      ["First", "Last", "Class"],
      ["Dina", "Levi", "K1"],
      ["Avi", "Levi", "k1 "],
      ["Tova", "Stern", "K2"],
    ];
    const report = buildImportReport(grid, detectLayout(grid), {
      knownClassNames: [],
      unknownClasses: "create",
    });
    expect(report.newClasses).toEqual(["K1", "K2"]);
    expect(report.toImport).toHaveLength(3);
  });
});

describe("sibling suggestions never merge families on weak evidence", () => {
  it("ignores placeholder parent values like N/A", () => {
    const suggestions = suggestSiblingCarpools([
      student("Miriam", "Cohen", "N/A"),
      student("Aaron", "Cohen", "n/a"),
      student("Rivka", "Cohen", "Sarah Cohen"),
      student("Eli", "Cohen", "Sarah Cohen"),
    ]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].memberIndexes).toEqual([2, 3]);
    expect(suggestions[0].recommended).toBe(true);
  });

  it("ignores parent cells with no letters", () => {
    const suggestions = suggestSiblingCarpools([
      student("Miriam", "Cohen", "-"),
      student("Aaron", "Cohen", "?"),
      student("Rivka", "Katz", "Dina Katz"),
    ]);
    expect(suggestions).toEqual([]);
  });

  it("offers a shared one-word parent name unticked", () => {
    const suggestions = suggestSiblingCarpools([
      student("Miriam", "Cohen", "Sarah"),
      student("Aaron", "Cohen", "Sarah"),
    ]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].basis).toBe("parent-first-name");
    expect(suggestions[0].recommended).toBe(false);
  });
});

describe("carpool spelling", () => {
  it("sends one spelling for names that differ only in spacing and case", () => {
    const grid = [
      ["First", "Last", "Carpool"],
      ["Miriam", "Cohen", "Cohen  family"],
      ["Aaron", "Cohen", "cohen family"],
    ];
    const state = {
      ...initialImportState,
      grid,
      layout: detectLayout(grid),
    };
    const review = deriveReview(state, {
      knownClassNames: [],
      rosterNames: [],
      carpoolNames: [],
    })!;
    const sent = new Set(review.students.map((s) => s.carpool));
    expect(sent.size).toBe(1);
    expect(review.carpools).toHaveLength(1);
    expect(review.carpools[0].memberCount).toBe(2);
  });
});
