import { describe, expect, it } from "vitest";

import { KEYTERM_LIMIT, buildKeyterms } from "./keyterms.ts";

const student = (
  last_name: string,
  overrides: Partial<{ aliases: string[]; status: "waiting" | "arrived" }> = {},
) => ({
  last_name,
  aliases: overrides.aliases ?? [],
  status: overrides.status ?? "waiting",
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

  it("offers every carpool regardless of the roster passed in", () => {
    // Carpools are not narrowed by the announce screen's grade/class filter --
    // a carpool can span grades -- so this only proves carpools with no
    // matching students still make the list.
    const terms = buildKeyterms([], [{ name: "Weiss Carpool", aliases: [] }]);

    expect(terms).toEqual(["Weiss Carpool"]);
  });
});
