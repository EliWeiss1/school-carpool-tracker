import { describe, expect, it } from "vitest";

import { CLASS_GROUPS } from "@/lib/classes";

describe("CLASS_GROUPS", () => {
  it("lists K1, K2, then 1st through 5th in that order", () => {
    expect(CLASS_GROUPS).toEqual(["K1", "K2", "1st", "2nd", "3rd", "4th", "5th"]);
  });
});
