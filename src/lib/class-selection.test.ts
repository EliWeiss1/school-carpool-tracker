import { describe, expect, it } from "vitest";

import { toggleClass } from "./class-selection";

const ALL = ["K1", "K2", "Choir"];

describe("toggleClass", () => {
  it("adds a class and keeps the result in class order, not click order", () => {
    expect(toggleClass(["Choir"], "K1", true, ALL)).toEqual(["K1", "Choir"]);
  });

  it("removes a class", () => {
    expect(toggleClass(["K1", "Choir"], "K1", false, ALL)).toEqual(["Choir"]);
  });

  it("submits [] when the last class is unticked", () => {
    expect(toggleClass(["K1"], "K1", false, ALL)).toEqual([]);
  });

  it("keeps a class the student has that is no longer in the list", () => {
    // A stale name must survive an edit rather than being silently dropped.
    expect(toggleClass(["Old"], "K2", true, ALL)).toEqual(["K2", "Old"]);
  });
});
