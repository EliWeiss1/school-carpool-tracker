import { describe, expect, it } from "vitest";

import {
  emptyClassLabel,
  resolveInitialSectionKey,
  resolveSectionKey,
} from "./display-filter";
import type { FilterOption } from "./display-sections";

const options: FilterOption[] = [
  { key: "K1", label: "K1", waiting: 2, total: 2 },
  { key: "6th grade", label: "6th grade", waiting: 0, total: 0 },
  { key: "__none__", label: "Ungrouped", waiting: 1, total: 1 },
];

describe("resolveSectionKey", () => {
  it("matches a label case-insensitively, empty classes included", () => {
    expect(resolveSectionKey("6TH GRADE", options)).toBe("6th grade");
    expect(resolveSectionKey("k1", options)).toBe("K1");
  });

  it("accepts a stored key exactly", () => {
    expect(resolveSectionKey("__none__", options)).toBe("__none__");
  });

  it("returns null for a class that no longer exists, or nothing", () => {
    expect(resolveSectionKey("8th grade", options)).toBeNull();
    expect(resolveSectionKey("", options)).toBeNull();
    expect(resolveSectionKey(null, options)).toBeNull();
  });
});

describe("resolveInitialSectionKey", () => {
  it("prefers the URL over the remembered choice", () => {
    expect(
      resolveInitialSectionKey({ urlParam: "6th grade", stored: "K1", options }),
    ).toBe("6th grade");
  });

  it("falls back to the remembered choice when the URL class is unknown", () => {
    expect(
      resolveInitialSectionKey({ urlParam: "9th", stored: "K1", options }),
    ).toBe("K1");
  });

  it("falls back to All classes when neither resolves", () => {
    expect(
      resolveInitialSectionKey({ urlParam: "9th", stored: "gone", options }),
    ).toBe("");
    expect(
      resolveInitialSectionKey({ urlParam: null, stored: null, options }),
    ).toBe("");
  });
});

describe("emptyClassLabel", () => {
  it("names a chosen class that has nobody in it", () => {
    expect(emptyClassLabel("6th grade", options, [])).toBe("6th grade");
  });

  it("is null when the class has students on screen", () => {
    expect(emptyClassLabel("K1", options, [{}])).toBeNull();
  });

  it("is null for All classes or a key that is not an option", () => {
    expect(emptyClassLabel("", options, [])).toBeNull();
    expect(emptyClassLabel("gone", options, [])).toBeNull();
  });
});
