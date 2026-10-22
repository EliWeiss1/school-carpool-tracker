import { describe, expect, it } from "vitest";
import { SAMPLE_ROSTER } from "./roster";

/**
 * The roster's job is to be *hard*. These tests exist so a later tidy-up can't
 * quietly remove the confusable names that phase 3's matcher is tuned against.
 */

const CLASSES = new Set(["K1", "K2", "1st", "2nd", "3rd", "4th", "5th"]);

describe("sample roster shape", () => {
  it("has every required field populated", () => {
    for (const s of SAMPLE_ROSTER) {
      expect(s.first_name.trim(), JSON.stringify(s)).not.toBe("");
      expect(s.last_name.trim(), JSON.stringify(s)).not.toBe("");
      expect(s.class_groups.length, JSON.stringify(s)).toBeGreaterThanOrEqual(
        1,
      );
    }
  });

  it("uses valid class names, with no class listed twice for one student", () => {
    for (const s of SAMPLE_ROSTER) {
      for (const name of s.class_groups) {
        expect(CLASSES.has(name), name).toBe(true);
      }
      expect(new Set(s.class_groups).size, JSON.stringify(s)).toBe(
        s.class_groups.length,
      );
    }
  });

  it("has 105 students", () => {
    expect(SAMPLE_ROSTER).toHaveLength(105);
  });

  // Counts memberships, not students: six students are in two classes, so the
  // per-class totals sum to 111 while the student count stays 105. Each class
  // keeps its 15 primary students; the extras land on top of that.
  it("balances primary classes at 15 and adds six second-class memberships", () => {
    const primary = new Map<string, number>();
    const memberships = new Map<string, number>();
    for (const s of SAMPLE_ROSTER) {
      primary.set(s.class_groups[0], (primary.get(s.class_groups[0]) ?? 0) + 1);
      for (const name of s.class_groups) {
        memberships.set(name, (memberships.get(name) ?? 0) + 1);
      }
    }
    for (const name of CLASSES) expect(primary.get(name), name).toBe(15);

    const total = [...memberships.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(111);
  });

  it("includes six deliberately multi-class students, in two classes each", () => {
    const multi = SAMPLE_ROSTER.filter((s) => s.class_groups.length > 1);
    expect(multi).toHaveLength(6);
    for (const s of multi) expect(s.class_groups).toHaveLength(2);
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
    expect(short.length, "expected 2-3 letter surnames").toBeGreaterThanOrEqual(
      3,
    );
  });
});
