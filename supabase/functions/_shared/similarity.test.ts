import { describe, expect, it } from "vitest";

import { jaroWinkler } from "./similarity.ts";

describe("jaroWinkler", () => {
  it("scores identical strings 1", () => {
    expect(jaroWinkler("cohen", "cohen")).toBe(1);
    expect(jaroWinkler("", "")).toBe(1);
  });

  it("scores a string against nothing 0", () => {
    expect(jaroWinkler("cohen", "")).toBe(0);
    expect(jaroWinkler("", "cohen")).toBe(0);
  });

  it("matches the published score for a transposition", () => {
    expect(jaroWinkler("martha", "marhta")).toBeCloseTo(0.961, 3);
  });

  it("matches the published score for an insertion", () => {
    expect(jaroWinkler("dwayne", "duane")).toBeCloseTo(0.84, 3);
  });

  it("caps the shared-prefix bonus at four characters", () => {
    // Five shared leading characters, but only four may be rewarded — otherwise
    // a long common prefix drowns out a differing tail.
    expect(jaroWinkler("aaaaab", "aaaaac")).toBeCloseTo(0.9333, 3);
  });

  it("is symmetric", () => {
    expect(jaroWinkler("marchetti", "marsh")).toBe(
      jaroWinkler("marsh", "marchetti"),
    );
  });

  it("scores an unrelated name well below a near miss", () => {
    expect(jaroWinkler("cohen", "kohen")).toBeGreaterThan(
      jaroWinkler("cohen", "marchetti"),
    );
  });

  it("stays within 0 and 1 for a one-character name", () => {
    const score = jaroWinkler("y", "yu");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
