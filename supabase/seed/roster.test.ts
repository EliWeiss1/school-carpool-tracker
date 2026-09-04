import { describe, expect, it } from "vitest";
import { SAMPLE_ROSTER } from "./roster";

/**
 * The roster's job is to be *hard*. These tests exist so a later tidy-up can't
 * quietly remove the confusable names that phase 3's matcher is tuned against.
 */

describe("sample roster shape", () => {
  it("has every required field populated", () => {
    for (const s of SAMPLE_ROSTER) {
      expect(s.first_name.trim(), JSON.stringify(s)).not.toBe("");
      expect(s.last_name.trim(), JSON.stringify(s)).not.toBe("");
      expect(s.class_group.trim(), JSON.stringify(s)).not.toBe("");
    }
  });

  it("uses valid class_group values", () => {
    const validClasses = new Set(["K1", "K2", "1st", "2nd", "3rd", "4th", "5th"]);
    for (const s of SAMPLE_ROSTER) {
      expect(validClasses.has(s.class_group), s.class_group).toBe(true);
    }
  });

  it("has no two students with the same full name", () => {
    const full = SAMPLE_ROSTER.map((s) =>
      `${s.first_name} ${s.last_name}`.toLowerCase(),
    );
    expect(new Set(full).size).toBe(full.length);
  });

  it("never lists a student's own surname as one of their aliases", () => {
    for (const s of SAMPLE_ROSTER) {
      const own = s.last_name.toLowerCase();
      expect(
        s.aliases.map((a) => a.toLowerCase()),
        `${s.last_name} aliases`,
      ).not.toContain(own);
    }
  });
});

describe("sample roster adversarial coverage", () => {
  const surnames = new Set(SAMPLE_ROSTER.map((s) => s.last_name));

  const clusters: Array<[string, string[]]> = [
    ["Cohen family", ["Cohen", "Kohen", "Koen", "Kohn", "Cohn"]],
    ["Levi family", ["Levi", "Levy", "Levine", "Levin"]],
    ["Stein family", ["Stein", "Steen", "Steinberg"]],
    ["Klein family", ["Klein", "Kline"]],
    ["Shapiro family", ["Shapiro", "Shapira"]],
    ["Rosen family", ["Rosen", "Rosenberg", "Rosenthal"]],
    ["Gold family", ["Gold", "Goldman", "Goldberg", "Goldstein"]],
    ["Weiss family", ["Weiss", "Wise", "Weiser"]],
    ["Berg family", ["Berg", "Berger", "Bergman"]],
  ];

  it.each(clusters)("keeps the %s cluster intact", (_label, names) => {
    for (const name of names) {
      expect(surnames.has(name), `missing ${name}`).toBe(true);
    }
  });

  it("includes a shared surname so first names have to disambiguate", () => {
    const cohens = SAMPLE_ROSTER.filter((s) => s.last_name === "Cohen");
    expect(cohens.length).toBeGreaterThanOrEqual(2);
    expect(new Set(cohens.map((s) => s.first_name)).size).toBe(cohens.length);
  });

  it("has plenty of confusable surname variants to stress-test the matcher", () => {
    const surnames_set = new Set(SAMPLE_ROSTER.map((s) => s.last_name));
    // The roster's adversarial clusters (Cohen/Kohen/Koen/Kohn, Levi/Levy, etc.)
    // provide the hard cases for fuzzy + phonetic matching
    expect(surnames_set.size).toBeGreaterThan(40); // well above 7 classes * 1 unique surname
  });

  // Authentic 2-letter Jewish/Hebrew surnames are essentially nonexistent
  // (unlike the old roster's romanized "Ng"/"Oh"/"Yu"); short Hebraized
  // surnames like Oz/Tal/Bar run 2-3 letters, so the bound moves to match
  // real names rather than forcing an unrealistic one to hit length 2.
  it("includes very short surnames, where one edit is most of the string", () => {
    const short = SAMPLE_ROSTER.filter((s) => s.last_name.length <= 3);
    expect(
      short.length,
      "expected 2-3 letter surnames",
    ).toBeGreaterThanOrEqual(3);
  });
});
