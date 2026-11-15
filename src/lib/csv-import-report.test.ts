import { describe, expect, it } from "vitest";

import { MAX_CLASSES, buildImportReport } from "./csv-import";
import { detectLayout } from "./import/detect-columns";

function report(
  grid: string[][],
  context: Parameters<typeof buildImportReport>[2] = {},
) {
  return buildImportReport(grid, detectLayout(grid), context);
}

describe("buildImportReport", () => {
  it("splits a full-name column with comma names", () => {
    const r = report([
      ["Name", "Class"],
      ["Cohen, Miriam", "K1"],
      ["Levy, Yosef Dov", "2nd"],
    ]);
    expect(r.headerErrors).toEqual([]);
    expect(r.toImport.map((s) => [s.first_name, s.last_name])).toEqual([
      ["Miriam", "Cohen"],
      ["Yosef Dov", "Levy"],
    ]);
  });

  it("counts title rows and numbers rows like the spreadsheet", () => {
    const r = report([
      ["Spring roster"],
      [""],
      ["First Name", "Last Name"],
      ["Maya", "Cohen"],
      ["", "Levy"],
    ]);
    expect(r.titleRowsSkipped).toBe(2);
    expect(r.toImportRows).toEqual([4]);
    expect(r.errors).toEqual([
      { rowNumber: 5, message: "Missing a first name." },
    ]);
  });

  describe("unknown classes", () => {
    const grid = [
      ["First Name", "Last Name", "Class"],
      ["Maya", "Cohen", "Choir; k1"],
      ["Aaron", "Levy", "choir"],
      ["Noa", "Katz", "Robotics"],
      ["Noa", "Katz", "Chess"],
    ];

    it("create collects each new class once, first spelling, import rows only", () => {
      const r = report(grid, {
        knownClassNames: ["K1"],
        unknownClasses: "create",
      });
      expect(r.errors.map((e) => e.rowNumber)).toEqual([5]);
      expect(r.newClasses).toEqual(["Choir", "Robotics"]);
    });

    it("reject makes row errors", () => {
      const r = report(grid, { knownClassNames: ["K1"] });
      expect(r.newClasses).toEqual([]);
      expect(r.errors.length).toBeGreaterThan(0);
      expect(r.errors[0].message).toContain('"Choir"');
      expect(r.toImport).toEqual([]);
    });
  });

  it("skips students already on the roster without error", () => {
    const r = report(
      [
        ["First Name", "Last Name"],
        ["MAYA", "cohen"],
        ["Aaron", "Levy"],
      ],
      { rosterNames: [{ first_name: "Maya", last_name: "Cohen" }] },
    );
    expect(r.errors).toEqual([]);
    expect(r.alreadyOnRoster).toEqual([{ rowNumber: 2, name: "MAYA cohen" }]);
    expect(r.toImport).toHaveLength(1);
  });

  it("tolerates empty cells beyond the header but errors on a filled one", () => {
    const r = report([
      ["First Name", "Last Name"],
      ["Maya", "Cohen", "", ""],
      ["Aaron", "Levy", "stray"],
    ]);
    expect(r.toImport).toHaveLength(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].rowNumber).toBe(3);
  });

  it("refuses a file that brings the class total past the limit", () => {
    const rows = Array.from({ length: MAX_CLASSES + 1 }, (_, i) => [
      `S${i}`,
      "Smith",
      `Class ${i}`,
    ]);
    const r = report([["First Name", "Last Name", "Class"], ...rows], {
      knownClassNames: ["Existing"],
      unknownClasses: "create",
    });
    expect(r.headerErrors).toHaveLength(1);
    expect(r.toImport).toEqual([]);
    expect(r.toImportRows).toEqual([]);
  });
});
