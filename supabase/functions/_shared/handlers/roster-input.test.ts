import { describe, expect, it } from "vitest";

import { resolveClassNames } from "./roster-input.ts";

const classes = [
  { id: "c-1", name: "3rd" },
  { id: "c-2", name: "K1" },
  { id: "c-3", name: "5th" },
];

describe("resolveClassNames", () => {
  it("resolves case-insensitively and trims", () => {
    expect(resolveClassNames([" k1 ", "3RD"], classes)).toEqual({
      ok: true,
      ids: ["c-2", "c-1"],
    });
  });

  it("drops duplicates and empty entries", () => {
    expect(
      resolveClassNames(["3rd", "", "  ", "3RD", "5th", "3rd"], classes),
    ).toEqual({
      ok: true,
      ids: ["c-1", "c-3"],
    });
  });

  it("returns the first unknown name", () => {
    expect(resolveClassNames(["3rd", "7th", "9th"], classes)).toEqual({
      ok: false,
      unknown: "7th",
    });
  });

  it("empty input yields ok with no ids", () => {
    expect(resolveClassNames([], classes)).toEqual({ ok: true, ids: [] });
  });
});
