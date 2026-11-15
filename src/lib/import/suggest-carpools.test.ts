import { describe, expect, it } from "vitest";

import type { CsvImportStudent } from "../csv-import";
import {
  applySuggestions,
  suggestSiblingCarpools,
  summarizeCarpools,
} from "./suggest-carpools";

function student(
  first: string,
  last: string,
  extra: Partial<CsvImportStudent> = {},
): CsvImportStudent {
  return {
    first_name: first,
    last_name: last,
    aliases: [],
    class_groups: [],
    carpool: null,
    parent1_name: null,
    parent2_name: null,
    ...extra,
  };
}

describe("suggestSiblingCarpools", () => {
  it("recommends one family for siblings sharing a parent", () => {
    const suggestions = suggestSiblingCarpools([
      student("Miriam", "Cohen", { parent1_name: "Sarah Cohen" }),
      student("Aaron", "Cohen", { parent1_name: "sarah  cohen" }),
    ]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      name: "Cohen family",
      memberIndexes: [0, 1],
      basis: "parents",
      recommended: true,
    });
  });

  it("never merges two Cohen families with different parents", () => {
    const suggestions = suggestSiblingCarpools([
      student("Miriam", "Cohen", { parent1_name: "Sarah Cohen" }),
      student("Aaron", "Cohen", { parent1_name: "Sarah Cohen" }),
      student("Dov", "Cohen", { parent1_name: "Rina Cohen" }),
      student("Eli", "Cohen", { parent2_name: "Rina Cohen" }),
    ]);
    expect(suggestions).toHaveLength(2);
    expect(suggestions.map((s) => s.name)).toEqual([
      "Cohen family (Sarah)",
      "Cohen family (Rina)",
    ]);
    expect(suggestions[0].memberIndexes).toEqual([0, 1]);
    expect(suggestions[1].memberIndexes).toEqual([2, 3]);
  });

  it("leaves out a Cohen with no parent in a file that has parents", () => {
    const suggestions = suggestSiblingCarpools([
      student("Miriam", "Cohen", { parent1_name: "Sarah Cohen" }),
      student("Aaron", "Cohen", { parent1_name: "Sarah Cohen" }),
      student("Dov", "Cohen"),
    ]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].memberIndexes).toEqual([0, 1]);
  });

  it("offers an unchecked surname guess when the file has no parents", () => {
    const suggestions = suggestSiblingCarpools([
      student("Miriam", "Cohen"),
      student("Aaron", "Cohen"),
      student("Noa", "Katz"),
    ]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      basis: "surname",
      recommended: false,
      memberIndexes: [0, 1],
    });
  });

  it("never includes a student who already has a carpool", () => {
    const suggestions = suggestSiblingCarpools([
      student("Miriam", "Cohen", { carpool: "Van 1" }),
      student("Aaron", "Cohen"),
      student("Dov", "Cohen"),
    ]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].memberIndexes).toEqual([1, 2]);
  });

  it("numbers a name that collides with a reserved one", () => {
    const suggestions = suggestSiblingCarpools(
      [student("Miriam", "Cohen"), student("Aaron", "Cohen")],
      ["cohen FAMILY"],
    );
    expect(suggestions[0].name).toBe("Cohen family 2");
  });
});

describe("applySuggestions", () => {
  const students = [
    student("Miriam", "Cohen"),
    student("Aaron", "Cohen"),
    student("Dov", "Cohen", { carpool: "Van 1" }),
  ];
  const suggestions = [
    {
      id: "s1",
      name: "Cohen family",
      memberIndexes: [0, 1, 2],
      basis: "surname" as const,
      recommended: false,
    },
  ];

  it("fills accepted suggestions but never overrides a typed carpool", () => {
    const result = applySuggestions(students, suggestions, new Set(["s1"]));
    expect(result.map((s) => s.carpool)).toEqual([
      "Cohen family",
      "Cohen family",
      "Van 1",
    ]);
  });

  it("does nothing for unaccepted suggestions", () => {
    const result = applySuggestions(students, suggestions, new Set());
    expect(result.map((s) => s.carpool)).toEqual([null, null, "Van 1"]);
  });
});

describe("summarizeCarpools", () => {
  it("counts members and marks existing names, keeping their spelling", () => {
    const summary = summarizeCarpools(
      [
        student("A", "One", { carpool: "cohen family" }),
        student("B", "Two", { carpool: "Cohen Family" }),
        student("C", "Three", { carpool: "Van 1" }),
        student("D", "Four"),
      ],
      ["Cohen family"],
    );
    expect(summary).toEqual([
      { name: "Cohen family", memberCount: 2, isNew: false },
      { name: "Van 1", memberCount: 1, isNew: true },
    ]);
  });
});
