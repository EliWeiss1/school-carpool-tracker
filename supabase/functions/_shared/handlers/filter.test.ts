import { describe, expect, it } from "vitest";

import { rosterFilterFrom } from "./filter.ts";

describe("rosterFilterFrom", () => {
  it("means every class when nothing is sent", () => {
    expect(rosterFilterFrom({})).toEqual({ classGroups: [] });
  });

  it("reads the legacy single classGroup string", () => {
    expect(rosterFilterFrom({ classGroup: "3rd" })).toEqual({
      classGroups: ["3rd"],
    });
  });

  it("reads a classGroups array", () => {
    expect(rosterFilterFrom({ classGroups: ["K1", "2nd"] })).toEqual({
      classGroups: ["K1", "2nd"],
    });
  });

  it("merges both spellings without duplicates", () => {
    expect(
      rosterFilterFrom({ classGroup: "K1", classGroups: ["K1", "2nd"] }),
    ).toEqual({ classGroups: ["K1", "2nd"] });
  });

  it("drops blanks, non-strings and whitespace", () => {
    expect(
      rosterFilterFrom({ classGroups: [" 1st ", "", "  ", 4, null, {}] }),
    ).toEqual({ classGroups: ["1st"] });
  });

  it("ignores a classGroups value that is not an array", () => {
    expect(rosterFilterFrom({ classGroups: "K1" })).toEqual({
      classGroups: [],
    });
  });

  it("bounds a hostile body", () => {
    const flood = Array.from({ length: 500 }, (_, i) => `class-${i}`);
    expect(rosterFilterFrom({ classGroups: flood }).classGroups).toHaveLength(
      50,
    );
  });
});
