import { describe, expect, it } from "vitest";

import { SLUG_PATTERN, suggestSlug, validateSlug } from "./school-slug";

describe("suggestSlug", () => {
  it("lowercases and joins words with hyphens", () => {
    expect(suggestSlug("Maple Grove Academy")).toBe("maple-grove-academy");
  });

  it("drops apostrophes instead of splitting the word", () => {
    expect(suggestSlug("St. Mary's School")).toBe("st-marys-school");
    expect(suggestSlug("St. Mary’s")).toBe("st-marys");
  });

  it("folds accents to plain letters", () => {
    expect(suggestSlug("Escuela Niño Jesús")).toBe("escuela-nino-jesus");
  });

  it("collapses runs of symbols and trims hyphens from the ends", () => {
    expect(suggestSlug("  --Beth & Sons!!  ")).toBe("beth-sons");
  });

  it("cuts to 48 characters without leaving a trailing hyphen", () => {
    const slug = suggestSlug("a".repeat(47) + " bbbb");
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("returns an empty string when nothing usable is left", () => {
    expect(suggestSlug("")).toBe("");
    expect(suggestSlug("!!!")).toBe("");
  });

  it("produces something validateSlug accepts for ordinary names", () => {
    for (const name of ["Maple Grove", "P.S. 22", "Yeshiva of Flatbush"]) {
      expect(validateSlug(suggestSlug(name))).toBeNull();
    }
  });
});

describe("validateSlug", () => {
  it("accepts the same set the database accepts", () => {
    for (const ok of ["abc", "a-b", "maple-grove-2", "a".repeat(48)]) {
      expect(validateSlug(ok)).toBeNull();
      expect(SLUG_PATTERN.test(ok)).toBe(true);
    }
  });

  it("rejects what the database would reject, each with a sentence", () => {
    for (const bad of [
      "",
      "ab",
      "a".repeat(49),
      "-abc",
      "abc-",
      "Abc",
      "a b c",
      "a_b",
      "café",
    ]) {
      expect(validateSlug(bad), bad).toEqual(expect.any(String));
      expect(SLUG_PATTERN.test(bad), bad).toBe(false);
    }
  });

  it("says what is wrong in plain words", () => {
    expect(validateSlug("")).toMatch(/enter a web address/i);
    expect(validateSlug("ab")).toMatch(/at least 3/i);
    expect(validateSlug("a".repeat(49))).toMatch(/48/);
    expect(validateSlug("Ab c")).toMatch(/lowercase letters, numbers/i);
    expect(validateSlug("-abc")).toMatch(/start and end/i);
  });
});
