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
      expect(s.grade.trim(), JSON.stringify(s)).not.toBe("");
      expect(s.class_group.trim(), JSON.stringify(s)).not.toBe("");
    }
  });

  it("keeps class_group prefixed by its grade", () => {
    for (const s of SAMPLE_ROSTER) {
      expect(s.class_group.startsWith(`${s.grade}-`), s.class_group).toBe(true);
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
    ["Cohen family", ["Cohen", "Kohen", "Koen", "Cowan"]],
    ["Ch- family", ["Chen", "Chan", "Chin"]],
    ["Lee homophones", ["Lee", "Li"]],
    ["one-character edits", ["Patel", "Patil", "Silva", "Silvia"]],
    ["same phonetics, different spelling", ["Smith", "Smyth"]],
    ["prefix containment", ["Brook", "Brooks", "Marsh", "Marchetti"]],
    ["Spanish onsets", ["Reyes", "Rios", "García", "Garza"]],
  ];

  it.each(clusters)("keeps the %s cluster intact", (_label, names) => {
    for (const name of names) {
      expect(surnames.has(name), `missing ${name}`).toBe(true);
    }
  });

  it("includes a shared surname so first names have to disambiguate", () => {
    const nguyens = SAMPLE_ROSTER.filter((s) => s.last_name === "Nguyen");
    expect(nguyens.length).toBeGreaterThanOrEqual(2);
    expect(new Set(nguyens.map((s) => s.first_name)).size).toBe(nguyens.length);
  });

  it("includes surnames the normalizer has to strip or fold", () => {
    const diacritics = SAMPLE_ROSTER.filter((s) =>
      /[^\u0000-\u007F]/.test(s.last_name),
    );
    const punctuation = SAMPLE_ROSTER.filter((s) => /['-]/.test(s.last_name));
    const spaced = SAMPLE_ROSTER.filter((s) => s.last_name.includes(" "));

    expect(
      diacritics.length,
      "expected surnames with diacritics",
    ).toBeGreaterThan(0);
    expect(
      punctuation.length,
      "expected surnames with punctuation",
    ).toBeGreaterThan(0);
    expect(spaced.length, "expected a multi-word surname").toBeGreaterThan(0);
  });

  it("includes very short surnames, where one edit is most of the string", () => {
    const short = SAMPLE_ROSTER.filter((s) => s.last_name.length <= 2);
    expect(short.length, "expected 2-letter surnames").toBeGreaterThanOrEqual(
      3,
    );
  });
});
