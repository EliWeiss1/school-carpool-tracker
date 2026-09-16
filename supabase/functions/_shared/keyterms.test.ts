import { describe, expect, it } from "vitest";

import { KEYTERM_LIMIT, buildKeyterms } from "./keyterms.ts";

const student = (
  last_name: string,
  overrides: Partial<{
    aliases: string[];
    status: "waiting" | "arrived";
    parent1_name: string | null;
    parent2_name: string | null;
  }> = {},
) => ({
  last_name,
  aliases: overrides.aliases ?? [],
  status: overrides.status ?? "waiting",
  parent1_name: overrides.parent1_name ?? null,
  parent2_name: overrides.parent2_name ?? null,
});

describe("buildKeyterms", () => {
  it("lists the surnames of the students who could still be called", () => {
    const terms = buildKeyterms([student("Cohen"), student("Nguyen")]);

    expect(terms).toEqual(["Cohen", "Nguyen"]);
  });

  it("puts waiting students ahead of students already picked up", () => {
    const terms = buildKeyterms([
      student("Brooks", { status: "arrived" }),
      student("Cohen", { status: "waiting" }),
    ]);

    expect(terms[0]).toBe("Cohen");
  });

  it("adds aliases only after every surname", () => {
    // Deepgram's keyterm budget is small. A surname nobody sent is a missed
    // student; a missing alternate spelling only costs the matcher some slack.
    const terms = buildKeyterms([
      student("Cohen", { aliases: ["Kohen"] }),
      student("Nguyen"),
    ]);

    expect(terms).toEqual(["Cohen", "Nguyen", "Kohen"]);
  });

  it("sends one term per spelling, however many students share it", () => {
    const terms = buildKeyterms([
      student("Nguyen"),
      student("Nguyen"),
      student("Cohen", { aliases: ["cohen"] }),
    ]);

    expect(terms).toEqual(["Nguyen", "Cohen"]);
  });

  it("stays inside the vendor's keyterm budget", () => {
    const roster = Array.from({ length: 400 }, (_, i) => student(`Name${i}`));

    expect(buildKeyterms(roster)).toHaveLength(KEYTERM_LIMIT);
  });

  it("honours a caller's tighter limit", () => {
    const terms = buildKeyterms(
      [student("Cohen"), student("Nguyen"), student("Patel")],
      [],
      { limit: 2 },
    );

    expect(terms).toEqual(["Cohen", "Nguyen"]);
  });

  it("skips blank names rather than sending an empty keyterm", () => {
    expect(
      buildKeyterms([student("  "), student("Cohen", { aliases: [""] })]),
    ).toEqual(["Cohen"]);
  });

  it("returns nothing for an empty roster", () => {
    expect(buildKeyterms([])).toEqual([]);
  });

  it("puts carpool names after waiting surnames but before arrived ones", () => {
    const terms = buildKeyterms(
      [
        student("Nguyen", { status: "waiting" }),
        student("Marsh", { status: "arrived" }),
      ],
      [{ name: "Weiss Carpool", aliases: [] }],
    );

    expect(terms).toEqual(["Nguyen", "Weiss Carpool", "Marsh"]);
  });

  it("adds carpool aliases in the same trailing tier as student aliases", () => {
    const terms = buildKeyterms(
      [student("Nguyen", { aliases: ["Win"] })],
      [{ name: "Weiss Carpool", aliases: ["The Van"] }],
    );

    expect(terms).toEqual(["Nguyen", "Weiss Carpool", "Win", "The Van"]);
  });

  it("puts parent names after carpools but before arrived surnames", () => {
    const terms = buildKeyterms([
      student("Weiss", { parent1_name: "Eli Weiss", parent2_name: "Dana Weiss" }),
      student("Marsh", { status: "arrived" }),
    ]);

    expect(terms).toEqual(["Weiss", "Eli Weiss", "Dana Weiss", "Marsh"]);
  });

  it("keeps a student's own parent name paired with their own surname under truncation", () => {
    // The bug this replaces: parent names used to sit in one trailing tier
    // behind every surname, so on a large roster only whichever names came
    // alphabetically first survived the limit -- unrelated to which
    // students actually had a parent name on file. Interleaving means a
    // truncated roster still pairs each surviving student with their own
    // parent name, not someone else's or nobody's.
    const roster = Array.from({ length: 60 }, (_, i) =>
      student(`Name${i}`, { parent1_name: `Parent${i}` }),
    );

    const terms = buildKeyterms(roster, [], { limit: 10 });

    expect(terms).toEqual([
      "Name0",
      "Parent0",
      "Name1",
      "Parent1",
      "Name2",
      "Parent2",
      "Name3",
      "Parent3",
      "Name4",
      "Parent4",
    ]);
  });

  it("skips a null or blank parent name", () => {
    const terms = buildKeyterms([
      student("Cohen", { parent1_name: "  ", parent2_name: null }),
    ]);

    expect(terms).toEqual(["Cohen"]);
  });

  it("offers every carpool regardless of the roster passed in", () => {
    // Carpools are not narrowed by the announce screen's class filter -- a
    // carpool can span classes -- so this only proves carpools with no
    // matching students still make the list.
    const terms = buildKeyterms([], [{ name: "Weiss Carpool", aliases: [] }]);

    expect(terms).toEqual(["Weiss Carpool"]);
  });
});
