import { describe, expect, it } from "vitest";

import { SAMPLE_ROSTER } from "../../seed/roster.ts";
import { MATCH_POLICY, resolveName, type ResolverStudent } from "./resolver.ts";

/** The seed roster, given stable ids so tests can name a specific student. */
const ROSTER: ResolverStudent[] = SAMPLE_ROSTER.map((student) => ({
  id: `${student.first_name}-${student.last_name}`,
  first_name: student.first_name,
  last_name: student.last_name,
  aliases: student.aliases,
}));

const ids = (result: { candidates: Array<{ student: ResolverStudent }> }) =>
  result.candidates.map((candidate) => candidate.student.id);

describe("resolveName — tier policy", () => {
  it("reports a clear match when one name wins by a real margin", () => {
    const result = resolveName("Oz", ROSTER);

    expect(result.tier).toBe("clear");
    expect(ids(result)[0]).toBe("Noach-Oz");
  });

  it("reports no match rather than guessing at an unknown name", () => {
    const result = resolveName("Washington", ROSTER);

    expect(result.tier).toBe("none");
    expect(result.candidates).toEqual([]);
  });

  it("does not let a very short surname match a long unrelated word", () => {
    // Jaro scores a short key generously against a long string: every letter of
    // "Oz" or "Tal" turns up somewhere in a long word. Without a length check,
    // an unrelated name would be offered as a plausible student.
    expect(resolveName("Washington", ROSTER).tier).toBe("none");
    expect(resolveName("Youngblood", ROSTER).tier).toBe("none");
  });

  it("reports no match for an empty transcript", () => {
    expect(resolveName("", ROSTER).tier).toBe("none");
  });

  it("reports no match against an empty roster", () => {
    expect(resolveName("Cohen", []).tier).toBe("none");
  });

  it("never returns more than the policy's candidate cap", () => {
    const result = resolveName("Cohen", ROSTER);
    expect(result.candidates.length).toBeLessThanOrEqual(
      MATCH_POLICY.maxCandidates,
    );
  });

  it("keeps every score in 0-1 so it can be logged as match_confidence", () => {
    for (const candidate of resolveName("Cohen", ROSTER).candidates) {
      expect(candidate.score).toBeGreaterThan(0);
      expect(candidate.score).toBeLessThanOrEqual(1);
    }
  });

  it("only calls a match clear when it clears both the floor and the margin", () => {
    // "Bar" is a standalone short surname, but "Berg"/"Berger" still turn up
    // as lower-scoring fallback candidates via their "Bergh" alias -- exactly
    // the shape this rule exists to check.
    const result = resolveName("Bar", ROSTER);
    const [top, runnerUp] = result.candidates;

    expect(top.score).toBeGreaterThanOrEqual(MATCH_POLICY.clearScore);
    expect(top.score - (runnerUp?.score ?? 0)).toBeGreaterThanOrEqual(
      MATCH_POLICY.clearMargin,
    );
  });
});

describe("resolveName — the named near-miss clusters", () => {
  it("refuses to choose between Cohen, Kohen, Koen, Kohn and Cohn", () => {
    const result = resolveName("Cohen", ROSTER);

    expect(result.tier).toBe("ambiguous");
    expect(ids(result)).toEqual(
      expect.arrayContaining(["Maya-Cohen", "Rivka-Cohen", "Aaron-Cohen"]),
    );
  });

  it("refuses to choose between the four children all named Steinberg", () => {
    const result = resolveName("Steinberg", ROSTER);

    expect(result.tier).toBe("ambiguous");
    expect(ids(result)).toEqual(
      expect.arrayContaining(["Shmuel-Steinberg", "Eli-Steinberg"]),
    );
  });

  it("refuses to choose between Klein and Kline", () => {
    const result = resolveName("Kline", ROSTER);

    expect(result.tier).toBe("ambiguous");
    expect(ids(result)).toEqual(
      expect.arrayContaining(["Chana-Kline", "Hirsh-Kline", "Yosef-Kline"]),
    );
  });

  it("refuses to choose between Shapiro and Shapira", () => {
    const result = resolveName("Shapiro", ROSTER);

    expect(result.tier).toBe("ambiguous");
    expect(ids(result)).toEqual(
      expect.arrayContaining(["Ezra-Shapiro", "Ilana-Shapiro", "Leeba-Shapiro"]),
    );
  });

  it("refuses to choose between Perlman and Pearlman", () => {
    const result = resolveName("Perlman", ROSTER);

    expect(result.tier).toBe("ambiguous");
    expect(ids(result)).toEqual(
      expect.arrayContaining(["Yitzchak-Perlman", "Zvi-Perlman"]),
    );
  });

  it("hears Gold as Gold, leaving Goldman well behind it", () => {
    const result = resolveName("Gold", ROSTER);
    const [top, ...rest] = result.candidates;

    expect(result.tier).toBe("clear");
    expect(top.student.id).toBe("Yael-Gold");
    for (const candidate of rest) {
      expect(top.score - candidate.score).toBeGreaterThanOrEqual(
        MATCH_POLICY.clearMargin,
      );
    }
  });

  it("separates Goldman from Gold the same way, in the other direction", () => {
    const result = resolveName("Goldman", ROSTER);

    expect(result.tier).toBe("clear");
    expect(ids(result)[0]).toBe("Gabriel-Goldman");
  });
});

describe("resolveName — how much of the transcript a match explains", () => {
  it("ignores filler around the name", () => {
    const bare = resolveName("Cohen", ROSTER);
    const padded = resolveName("uh, Cohen please", ROSTER);

    expect(padded.tier).toBe(bare.tier);
    expect(ids(padded)[0]).toBe(ids(bare)[0]);
  });

  it("cannot separate two students who share a surname", () => {
    const result = resolveName("Perlman", ROSTER);

    expect(result.tier).toBe("ambiguous");
    expect(ids(result)).toEqual(
      expect.arrayContaining(["Yitzchak-Perlman", "Zvi-Perlman"]),
    );
  });

  it("uses a spoken first name to settle a shared surname", () => {
    const result = resolveName("Yitzchak Perlman", ROSTER);

    expect(result.tier).toBe("clear");
    expect(ids(result)[0]).toBe("Yitzchak-Perlman");
  });

  it("still uses the first name to settle it the other way too", () => {
    const result = resolveName("Zvi Perlman", ROSTER);

    expect(result.tier).toBe("clear");
    expect(ids(result)[0]).toBe("Zvi-Perlman");
  });
});

describe("resolveName — Deepgram alternatives", () => {
  it("matches on an alias and says so", () => {
    // "Otz" is nothing like the spelling "Oz"; only the alias list connects them.
    const result = resolveName("Otz", ROSTER);

    expect(ids(result)[0]).toBe("Noach-Oz");
    expect(result.candidates[0].matchedVia).toBe("alias");
    expect(result.candidates[0].matchedOn).toBe("Otz");
  });

  it("ranks a more confident alternative first but still refuses to choose", () => {
    // Two alternatives that are each an exact roster hit is precisely the case
    // where a confident guess would put the wrong child on a teacher's screen.
    const result = resolveName(
      [
        { transcript: "Kohn", confidence: 0.9 },
        { transcript: "Cohen", confidence: 0.5 },
      ],
      ROSTER,
    );

    expect(ids(result)[0]).toBe("Jonah-Kohn");
    expect(result.tier).toBe("ambiguous");
  });

  it("can match on a later alternative when the first is nonsense", () => {
    const result = resolveName(
      [
        { transcript: "mmm", confidence: 0.2 },
        { transcript: "Goldman", confidence: 0.8 },
      ],
      ROSTER,
    );

    expect(result.tier).toBe("clear");
    expect(ids(result)[0]).toBe("Gabriel-Goldman");
  });

  it("reports the alternative the top candidate came from, for the audit log", () => {
    const result = resolveName(
      [
        { transcript: "mmm", confidence: 0.2 },
        { transcript: "Goldman", confidence: 0.8 },
      ],
      ROSTER,
    );

    expect(result.transcript).toBe("Goldman");
  });
});

describe("resolveName — names that are not on the roster at all", () => {
  // Every other test in this file says a roster name into the roster. That left
  // the direction that actually hurts untested: a surname nobody here has,
  // confidently matched to a child who is. A wrong "clear" pre-highlights the
  // wrong name; these must never reach that tier.
  const strangers = [
    "Cohan",
    "Kagan",
    "Levit",
    "Levitt",
    "Steiner",
    "Klain",
    "Shapell",
    "Rosner",
    "Goldfarb",
    "Weissman",
    "Burke",
    "Alderman",
    "Fishman",
    "Feldstein",
    "Greenspan",
    "Silverstein",
    "Millman",
    "Perlmutter",
    "Wexford",
    "Barsky",
    "Talbot",
    "Ostrow",
  ];

  it.each(strangers)("does not pre-highlight anyone for %s", (transcript) => {
    expect(resolveName(transcript, ROSTER).tier).not.toBe("clear");
  });

  it("does not pre-highlight a child when someone says oh", () => {
    // Deepgram emits interjections routinely, and none of these names is "Oh".
    const kindergarten = ROSTER.filter((student) =>
      [
        "Maya-Cohen",
        "Ari-Kohen",
        "Noa-Koen",
        "Eitan-Levi",
        "Shira-Levy",
        "Mira-Stein",
      ].includes(student.id),
    );

    expect(resolveName("Oh", kindergarten).tier).not.toBe("clear");
  });
});

describe("resolveName — a first name that does not belong to the surname", () => {
  // The coverage discount rewards a match for explaining more of what was said.
  // An inexact two-word match must not use that to outrank an exact surname.
  const mismatched: Array<[transcript: string, correct: string]> = [
    ["Maya Chen", "Maya-Cohen"],
    ["Ari Cohen", "Maya-Cohen"],
    ["Noa Kohen", "Ari-Kohen"],
    ["Yitzchak Pearlman", "Esther-Pearlman"],
    ["Naomi Wise", "Devorah-Wise"],
    ["Talia Kline", "Chana-Kline"],
  ];

  it.each(mismatched)(
    "does not pre-highlight the wrong child for %s",
    (transcript) => {
      expect(resolveName(transcript, ROSTER).tier).not.toBe("clear");
    },
  );

  it("still ranks the child whose surname was actually said first", () => {
    // "Ari" is really Ari-Kohen's first name, but "Cohen" is Maya's exact
    // surname -- the exact surname match outranks every Kohen, whose surname
    // does not exactly match what was said.
    expect(ids(resolveName("Ari Cohen", ROSTER))[0]).toBe("Maya-Cohen");
  });
});
