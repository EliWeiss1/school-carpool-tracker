import { describe, expect, it } from "vitest";

import { candidateKey, candidateLabel } from "./announce-reducer";
import type { PadStudent } from "./class-roster";
import {
  SUGGESTION_LIMIT,
  buildTypeaheadIndex,
  normalizeQuery,
  suggest,
  type TypeaheadCarpool,
} from "./typeahead";

const s = (
  id: string,
  first_name: string,
  last_name: string,
  overrides: Partial<PadStudent> = {},
): PadStudent => ({
  id,
  first_name,
  last_name,
  class_groups: ["K1"],
  status: "waiting",
  carpool_id: null,
  ...overrides,
});

const roster: PadStudent[] = [
  s("miriam", "Miriam", "Cohen", { carpool_id: "cp-cohen", class_groups: ["2nd"] }),
  s("aaron", "Aaron", "Cohen", { carpool_id: "cp-cohen", class_groups: ["K1"] }),
  s("rivka", "Rivka", "Cohen"),
  s("yosef", "Yosef", "Kohn", { aliases: ["Yossi"] }),
  s("coby", "Coby", "Levi"),
  s("dina", "Dina", "Rosenberg", { class_groups: ["5th"] }),
  s("eli", "Eli", "Bergman", { status: "arrived" }),
  s("ezra", "Ezra", "Berg"),
  s("noa", "Noa", "Ben-David"),
];

const carpools: TypeaheadCarpool[] = [
  { id: "cp-cohen", name: "Cohen Family", aliases: [] },
  { id: "cp-green", name: "Green Street", aliases: ["Greens"] },
];

const index = buildTypeaheadIndex(roster, carpools);
const keys = (query: string, classGroups: string[] = []) =>
  suggest(index, query, classGroups).candidates.map(candidateKey);

describe("normalizeQuery", () => {
  it("case-folds, strips accents and apostrophes, and splits on punctuation", () => {
    expect(normalizeQuery("  O'Brien ")).toBe("obrien");
    expect(normalizeQuery("José")).toBe("jose");
    expect(normalizeQuery("Ben-David")).toBe("ben david");
  });
});

describe("suggest", () => {
  it("returns nothing for an empty or punctuation-only query", () => {
    expect(suggest(index, "   ")).toEqual({ tier: "none", candidates: [] });
    expect(suggest(index, "--")).toEqual({ tier: "none", candidates: [] });
  });

  it("finds a student by the start of their last name", () => {
    expect(keys("kohn")).toEqual(["student:yosef"]);
  });

  it("finds a student by the start of their first name", () => {
    expect(keys("dina")).toEqual(["student:dina"]);
  });

  it("finds a student by an alias", () => {
    expect(keys("yoss")).toEqual(["student:yosef"]);
  });

  it("finds a student by first and last name together, in either order", () => {
    expect(keys("rivka co")).toEqual(["student:rivka"]);
    expect(keys("cohen rivka")).toEqual(["student:rivka"]);
  });

  it("finds either half of a hyphenated surname", () => {
    expect(keys("david")).toEqual(["student:noa"]);
  });

  it("offers a carpool member as their whole carpool, with every rider", () => {
    const { candidates } = suggest(index, "aaron");
    expect(candidates).toHaveLength(1);
    expect(candidateLabel(candidates[0])).toBe("Cohen Family");
    expect(candidates[0].students.map((st) => st.id)).toEqual(["aaron", "miriam"]);
  });

  it("collapses siblings who both match into one carpool suggestion", () => {
    expect(keys("cohen")).toEqual(["carpool:cp-cohen", "student:rivka"]);
  });

  it("finds a carpool by its own name", () => {
    expect(keys("cohen fam")).toEqual(["carpool:cp-cohen"]);
  });

  it("never offers a carpool with no riders on the roster", () => {
    expect(keys("green")).toEqual([]);
    expect(keys("greens")).toEqual([]);
  });

  it("finds a carpool by an alias", () => {
    const withAlias = buildTypeaheadIndex(roster, [
      { id: "cp-cohen", name: "Cohen Family", aliases: ["Blue Van"] },
    ]);
    expect(suggest(withAlias, "blue").candidates.map(candidateKey)).toEqual([
      "carpool:cp-cohen",
    ]);
  });

  it("offers a carpool member alone when the carpool's name is unknown", () => {
    const noCarpools = buildTypeaheadIndex(roster, []);
    expect(suggest(noCarpools, "aaron").candidates.map(candidateKey)).toEqual([
      "student:aaron",
    ]);
  });

  it("ranks an exact name above a name it is only the start of", () => {
    expect(keys("berg")).toEqual(["student:ezra", "student:eli", "student:dina"]);
  });

  it("only matches mid-word from three letters on", () => {
    expect(keys("er")).not.toContain("student:dina");
    expect(keys("enberg")).toEqual(["student:dina"]);
  });

  it("puts someone still waiting ahead of an equally good match who has arrived", () => {
    const tied = buildTypeaheadIndex(
      [s("a", "Avi", "Stern", { status: "arrived" }), s("b", "Avi", "Stein")],
      [],
    );
    expect(suggest(tied, "avi").candidates.map(candidateKey)).toEqual([
      "student:b",
      "student:a",
    ]);
  });

  it("narrows to the chosen classes; a carpool is in scope when any rider is", () => {
    expect(keys("cohen", ["K1"])).toEqual(["carpool:cp-cohen", "student:rivka"]);
    expect(keys("cohen", ["2nd"])).toEqual(["carpool:cp-cohen"]);
    expect(keys("cohen", ["5th"])).toEqual([]);
    expect(keys("rosen", ["K1"])).toEqual([]);
  });

  it("matches any of a student's classes and lists them once", () => {
    const multi = buildTypeaheadIndex(
      [s("lev", "Lev", "Zimmer", { class_groups: ["K1", "2nd"] })],
      [],
    );
    const out = suggest(multi, "zimmer", ["K1", "2nd"]).candidates;
    expect(out).toHaveLength(1);
    expect(suggest(multi, "zimmer", ["2nd"]).candidates).toHaveLength(1);
    expect(suggest(multi, "zimmer", ["5th"]).candidates).toHaveLength(0);
  });

  it("includes a classless student with no filter, but any filter excludes them", () => {
    const loose = buildTypeaheadIndex(
      [s("nada", "Nada", "Orphan", { class_groups: [] })],
      [],
    );
    expect(suggest(loose, "orphan").candidates).toHaveLength(1);
    expect(suggest(loose, "orphan", ["K1"]).candidates).toHaveLength(0);
  });

  it("carries every class onto the candidate", () => {
    const multi = buildTypeaheadIndex(
      [s("lev", "Lev", "Zimmer", { class_groups: ["K1", "2nd"] })],
      [],
    );
    expect(suggest(multi, "zimmer").candidates[0].students[0].class_groups).toEqual([
      "K1",
      "2nd",
    ]);
  });

  it("is clear only for a single suggestion", () => {
    expect(suggest(index, "dina").tier).toBe("clear");
    expect(suggest(index, "cohen").tier).toBe("ambiguous");
    expect(suggest(index, "zzz").tier).toBe("none");
  });

  it("caps the list", () => {
    const many = buildTypeaheadIndex(
      Array.from({ length: 20 }, (_, i) => s(`k${i}`, `Kid${i}`, "Adler")),
      [],
    );
    expect(suggest(many, "adl").candidates).toHaveLength(SUGGESTION_LIMIT);
  });

  it("stays fast on a roster far bigger than a school's", () => {
    const big = buildTypeaheadIndex(
      Array.from({ length: 2000 }, (_, i) =>
        s(`k${i}`, `First${i}`, `Surname${i}`, { aliases: [`Nick${i}`] }),
      ),
      [],
    );
    const start = performance.now();
    for (let i = 0; i < 100; i += 1) suggest(big, "surname1");
    // 100 keystrokes against roughly 20x the real roster.
    expect(performance.now() - start).toBeLessThan(500);
  });
});
