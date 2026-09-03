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
      {
        limit: 2,
      },
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
});
