import { describe, expect, it } from "vitest";

import { classSetChanged, toggleClass } from "./class-selection";

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

describe("classSetChanged", () => {
  it("is false when the set is unchanged", () => {
    expect(classSetChanged(["K1", "2nd"], ["K1", "2nd"])).toBe(false);
  });

  it("is false when only the order differs", () => {
    expect(classSetChanged(["K1", "2nd"], ["2nd", "K1"])).toBe(false);
  });

  it("is true when a class was added", () => {
    expect(classSetChanged(["K1"], ["K1", "2nd"])).toBe(true);
  });

  it("is true when a class was removed", () => {
    expect(classSetChanged(["K1", "2nd"], ["K1"])).toBe(true);
  });

  it("is true going from no classes to one", () => {
    expect(classSetChanged([], ["K1"])).toBe(true);
  });

  it("compares names exactly as stored (case-sensitive)", () => {
    expect(classSetChanged(["k1"], ["K1"])).toBe(true);
  });
});
