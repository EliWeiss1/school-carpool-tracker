import { describe, expect, it } from "vitest";

import {
  cellToString,
  pickSheet,
  sourceKindFor,
  stripCodeFence,
  textToGrid,
} from "./read-source";

describe("stripCodeFence", () => {
  it("keeps only the fenced CSV", () => {
    expect(stripCodeFence("Here you go:\n```csv\na,b\n1,2\n```\nThanks")).toBe(
      "a,b\n1,2",
    );
  });
  it("leaves unfenced text alone", () => {
    expect(stripCodeFence("a,b\n1,2")).toBe("a,b\n1,2");
  });
});

describe("textToGrid", () => {
  it("sniffs a tab-separated paste", () => {
    expect(textToGrid("a\tb\n1\t2").grid).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
  it("strips a byte-order mark", () => {
    expect(textToGrid("﻿a,b\n1,2").grid[0]).toEqual(["a", "b"]);
  });
  it("reads a fenced AI reply", () => {
    expect(textToGrid("Sure:\n```\na,b\n1,2\n```").grid).toHaveLength(2);
  });
  it("passes on an unterminated quote", () => {
    expect(textToGrid('a,b\n"x,1').unterminatedQuote).toBe(true);
  });
});

describe("cellToString", () => {
  it("converts each cell type", () => {
    expect(cellToString(null)).toBe("");
    expect(cellToString(undefined)).toBe("");
    expect(cellToString("x")).toBe("x");
    expect(cellToString(3)).toBe("3");
    expect(cellToString(true)).toBe("true");
    expect(cellToString(new Date("2026-03-04T00:00:00Z"))).toBe("2026-03-04");
    expect(cellToString(new Date("nope"))).toBe("");
    expect(cellToString({})).toBe("");
  });
});

describe("pickSheet", () => {
  it("picks the sheet with the most filled rows", () => {
    const picked = pickSheet([
      { sheet: "Cover", data: [["Welcome"]] },
      {
        sheet: "Students",
        data: [
          ["First", "Last"],
          ["Maya", 7],
          [null, null],
          ["Aaron", "Levy"],
        ],
      },
    ]);
    expect(picked.sheetName).toBe("Students");
    expect(picked.sheetCount).toBe(2);
    expect(picked.grid[1]).toEqual(["Maya", "7"]);
  });
  it("handles no sheets", () => {
    expect(pickSheet([]).grid).toEqual([]);
  });
});

describe("sourceKindFor", () => {
  it.each([
    ["r.xlsx", "", "xlsx"],
    ["r.XLSM", "", "xlsx"],
    ["r.xls", "", "xls"],
    ["r.numbers", "", "numbers"],
    ["r.csv", "", "text"],
    ["r.tsv", "", "text"],
    ["r.dat", "text/plain", "text"],
    ["r.pdf", "application/pdf", "unsupported"],
  ])("%s %s -> %s", (name, mime, kind) => {
    expect(sourceKindFor(name, mime)).toBe(kind);
  });
});
