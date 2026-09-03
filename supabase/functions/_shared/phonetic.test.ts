import { describe, expect, it } from "vitest";

import { phoneticCode } from "./phonetic.ts";

/** Every spelling in the group must reduce to one code. */
function expectSameCode(...spellings: string[]): void {
  const codes = spellings.map(phoneticCode);
  expect(
    new Set(codes).size,
    `expected one code, got ${codes.join(", ")}`,
  ).toBe(1);
}

describe("phoneticCode", () => {
  it("folds the C/K/Q onset class so Cohen and Kohen collide", () => {
    expectSameCode("Cohen", "Kohen", "Koen", "Coen");
  });

  it("keeps Cowan out of the Cohen group", () => {
    // Same onset, different vowel nucleus. Folding these together would bury a
    // real student under a homophone cluster they do not belong to.
    expect(phoneticCode("Cowan")).not.toBe(phoneticCode("Cohen"));
  });

  it("treats TH as one sound so Smith and Smyth collide", () => {
    expectSameCode("Smith", "Smyth");
  });

  it("folds the S/Z sibilant class so Nunez and Nunes collide", () => {
    expectSameCode("Nunez", "Nunes");
  });

  it("folds the F/V/PH class so Silva and Silvia collide", () => {
    expectSameCode("Silva", "Silvia");
  });

  it("silences a non-initial GH so Lee and Leigh collide", () => {
    expectSameCode("Lee", "Li", "Leigh");
  });

  it("drops non-initial vowels so Patel and Patil collide", () => {
    expectSameCode("Patel", "Patil");
  });

  it("codes CH as its own sound, distinct from the C/K class", () => {
    expectSameCode("Chen", "Chan", "Chin");
    expect(phoneticCode("Chen")).not.toBe(phoneticCode("Ken"));
  });

  it("keeps a trailing S, so Brook and Brooks stay apart", () => {
    expect(phoneticCode("Brook")).not.toBe(phoneticCode("Brooks"));
  });

  it("keeps a leading vowel or H, so very short surnames still code", () => {
    expect(phoneticCode("Oh")).toBe("O");
    expect(phoneticCode("Ho")).toBe("H");
    expect(phoneticCode("Yu")).toBe("Y");
    expect(phoneticCode("Ng")).toBe("NG");
  });

  it("keeps a hard G out of the C/K/Q class", () => {
    // Folding G onto K made Gwen a confident Cowan and Nagy a confident Ng.
    // They are different sounds; only C, K and Q needed merging.
    expect(phoneticCode("Gwen")).not.toBe(phoneticCode("Cowan"));
    expect(phoneticCode("Garza")).not.toBe(phoneticCode("Karsa"));
    // Nagy and Ng still share a code: the coder drops vowels by design, and
    // these two really do have one consonant skeleton. Keeping them apart is
    // the resolver's job, not this table's.
    expect(phoneticCode("Nagy")).toBe(phoneticCode("Ng"));
  });

  it("collapses a doubled sound", () => {
    expectSameCode("Chin", "Chinn");
    expectSameCode("Patel", "Patell");
  });

  it("drops the silent letter of an initial KN, GN, PN or WR", () => {
    expect(phoneticCode("Knight")).toBe(phoneticCode("Night"));
    expect(phoneticCode("Wright")).toBe(phoneticCode("Right"));
  });

  it("folds the punctuation and diacritics its input may still carry", () => {
    expectSameCode("Núñez", "Nunez");
    expectSameCode("O'Brien", "OBrien");
    expectSameCode("van der Berg", "Vanderberg");
  });

  it("returns an empty code for input with no letters", () => {
    expect(phoneticCode("")).toBe("");
    expect(phoneticCode("--")).toBe("");
  });
});
