import { describe, expect, it } from "vitest";

import {
  columnLetter,
  detectLayout,
  findHeaderRow,
  layoutProblems,
  matchHeading,
} from "./detect-columns";

describe("matchHeading", () => {
  it.each([
    ["Student First Name", "first_name"],
    ["child's_last_name", "last_name"],
    ["FIRST-NAME:", "first_name"],
    ["Surname", "last_name"],
    ["Homeroom Teacher", "class_groups"],
    ["Mother's Name", "parent1_name"],
    ["Student", "full_name"],
  ])("%s -> %s", (heading, field) => {
    expect(matchHeading(heading)?.field).toBe(field);
    expect(matchHeading(heading)?.confidence).toBe("high");
  });

  it("reads 'Last Name, First Name' as a last-first full name", () => {
    const match = matchHeading("Last Name, First Name");
    expect(match?.field).toBe("full_name");
    expect(match?.nameOrder).toBe("last-first");
  });

  it("does not match contact or record columns", () => {
    expect(matchHeading("Parent Email")).toBeNull();
    expect(matchHeading("Student ID")).toBeNull();
    expect(matchHeading("")).toBeNull();
  });
});

describe("findHeaderRow", () => {
  it("finds headings under a title row and a blank row", () => {
    const grid = [
      ["Spring roster 2026"],
      [""],
      ["First Name", "Last Name", "Class"],
      ["Maya", "Cohen", "K1"],
    ];
    expect(findHeaderRow(grid)).toBe(2);
  });
  it("returns -1 with no headings", () => {
    expect(
      findHeaderRow([
        ["Maya", "Cohen"],
        ["Aaron", "Levy"],
      ]),
    ).toBe(-1);
  });
});

describe("detectLayout", () => {
  it("binds last_name to the exact column, not a bare 'last'", () => {
    const layout = detectLayout([
      ["last", "first_name", "last_name"],
      ["x", "Maya", "Cohen"],
    ]);
    expect(layout.assignments).toEqual(["ignore", "first_name", "last_name"]);
  });

  it("maps Mother and Father to parent1 and parent2", () => {
    const layout = detectLayout([
      ["First Name", "Last Name", "Mother", "Father"],
      ["Maya", "Cohen", "Sarah", "David"],
    ]);
    expect(layout.assignments.slice(2)).toEqual([
      "parent1_name",
      "parent2_name",
    ]);
  });

  it("maps two Guardian columns to parent1 and parent2", () => {
    const layout = detectLayout([
      ["First Name", "Last Name", "Guardian", "Guardian"],
      ["Maya", "Cohen", "Sarah", "David"],
    ]);
    expect(layout.assignments.slice(2)).toEqual([
      "parent1_name",
      "parent2_name",
    ]);
  });

  it("ignores Name when first and last both exist", () => {
    const layout = detectLayout([
      ["Name", "First Name", "Last Name"],
      ["Maya C", "Maya", "Cohen"],
    ]);
    expect(layout.assignments).toEqual(["ignore", "first_name", "last_name"]);
  });

  it("samples the first three non-empty values", () => {
    const layout = detectLayout([
      ["First Name", "Last Name"],
      ["Maya", "Cohen"],
      ["", "Levy"],
      ["Aaron", "Katz"],
      ["Noa", "Berg"],
      ["Dan", "Roth"],
    ]);
    expect(layout.columns[0].samples).toEqual(["Maya", "Aaron", "Noa"]);
  });

  it("with a forced header row of -1 uses Column letters and ignores all", () => {
    const layout = detectLayout(
      [
        ["First Name", "Last Name"],
        ["Maya", "Cohen"],
      ],
      -1,
    );
    expect(layout.headerRowIndex).toBe(-1);
    expect(layout.columns.map((c) => c.heading)).toEqual([
      "Column A",
      "Column B",
    ]);
    expect(layout.assignments).toEqual(["ignore", "ignore"]);
  });
});

describe("layoutProblems", () => {
  it("flags a missing name column", () => {
    expect(layoutProblems(["class_groups", "ignore"])).toHaveLength(1);
  });
  it("flags first name without last name", () => {
    expect(layoutProblems(["first_name"])[0]).toMatch(/last name/);
  });
  it("names the columns of a duplicate field", () => {
    const problems = layoutProblems([
      "first_name",
      "last_name",
      "class_groups",
      "class_groups",
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("C and D");
  });
  it("accepts a full name alone", () => {
    expect(layoutProblems(["full_name", "ignore"])).toEqual([]);
  });
});

describe("columnLetter", () => {
  it("counts like a spreadsheet", () => {
    expect(columnLetter(0)).toBe("A");
    expect(columnLetter(25)).toBe("Z");
    expect(columnLetter(26)).toBe("AA");
    expect(columnLetter(27)).toBe("AB");
  });
});
