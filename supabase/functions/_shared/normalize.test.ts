import { describe, expect, it } from "vitest";

import {
  compareKey,
  foldName,
  phraseCandidates,
  tokenize,
} from "./normalize.ts";

describe("foldName", () => {
  it("folds diacritics to their base letters", () => {
    expect(foldName("García")).toBe("garcia");
    expect(foldName("Núñez")).toBe("nunez");
  });

  it("folds letters that have no decomposed form", () => {
    expect(foldName("Straße")).toBe("strasse");
    expect(foldName("Kjærgård")).toBe("kjaergard");
  });

  it("turns punctuation into a separator rather than deleting it", () => {
    expect(foldName("Al-Rashid")).toBe("al rashid");
    expect(foldName("O'Brien")).toBe("o brien");
  });

  it("collapses and trims whitespace", () => {
    expect(foldName("  van der  Berg ")).toBe("van der berg");
  });

  it("returns an empty string for input with no letters", () => {
    expect(foldName("  -- ")).toBe("");
    expect(foldName("")).toBe("");
  });
});

describe("compareKey", () => {
  // Separators are noise: the roster writes "van der Berg" and a speaker says
  // "vanderberg". Both sides collapse to the same key so neither spelling wins.
  it("drops every separator so spacing cannot affect a match", () => {
    expect(compareKey("van der Berg")).toBe("vanderberg");
    expect(compareKey("Al-Rashid")).toBe("alrashid");
    expect(compareKey("D'Angelo")).toBe("dangelo");
  });
});

describe("tokenize", () => {
  it("splits a transcript into folded words", () => {
    expect(tokenize("Uh, Cohen please!")).toEqual(["uh", "cohen", "please"]);
  });

  it("returns no tokens for an empty transcript", () => {
    expect(tokenize("   ")).toEqual([]);
  });
});

describe("phraseCandidates", () => {
  it("offers every contiguous run of words as a comparison key", () => {
    expect(phraseCandidates(["van", "der", "berg"], 3)).toEqual([
      { text: "van", words: 1 },
      { text: "der", words: 1 },
      { text: "berg", words: 1 },
      { text: "vander", words: 2 },
      { text: "derberg", words: 2 },
      { text: "vanderberg", words: 3 },
    ]);
  });

  it("never joins more words than the limit allows", () => {
    expect(phraseCandidates(["a", "b", "c", "d"], 2)).toEqual([
      { text: "a", words: 1 },
      { text: "b", words: 1 },
      { text: "c", words: 1 },
      { text: "d", words: 1 },
      { text: "ab", words: 2 },
      { text: "bc", words: 2 },
      { text: "cd", words: 2 },
    ]);
  });

  it("returns nothing for an empty transcript", () => {
    expect(phraseCandidates([], 3)).toEqual([]);
  });
});
