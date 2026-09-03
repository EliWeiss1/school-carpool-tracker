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
    const result = resolveName("Cowan", ROSTER);

    expect(result.tier).toBe("clear");
    expect(ids(result)[0]).toBe("Owen-Cowan");
  });

  it("reports no match rather than guessing at an unknown name", () => {
    const result = resolveName("Washington", ROSTER);

    expect(result.tier).toBe("none");
    expect(result.candidates).toEqual([]);
  });

  it("does not let a very short surname match a long unrelated word", () => {
    // Jaro scores a short key generously against a long string: every letter of
    // "Win" or "Ng" turns up somewhere in a long word. Without a length check,
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
    const result = resolveName("Cowan", ROSTER);
    const [top, runnerUp] = result.candidates;

    expect(top.score).toBeGreaterThanOrEqual(MATCH_POLICY.clearScore);
    expect(top.score - (runnerUp?.score ?? 0)).toBeGreaterThanOrEqual(
      MATCH_POLICY.clearMargin,
    );
  });
});

describe("resolveName — the named near-miss clusters", () => {
  it("refuses to choose between Cohen, Kohen and Koen", () => {
    const result = resolveName("Cohen", ROSTER);

    expect(result.tier).toBe("ambiguous");
    expect(ids(result)).toEqual(
      expect.arrayContaining(["Maya-Cohen", "Elias-Kohen", "Zoe-Koen"]),
    );
  });

  it("hears Cowan as Cowan, leaving the Cohens well behind it", () => {
    const result = resolveName("Cowan", ROSTER);
    const [top, ...rest] = result.candidates;

    expect(result.tier).toBe("clear");
    expect(top.student.id).toBe("Owen-Cowan");
    // The Cohens stay on the list as fallback tap targets, but none of them is
    // close enough to make this a coin toss.
    for (const candidate of rest) {
      expect(top.score - candidate.score).toBeGreaterThanOrEqual(
        MATCH_POLICY.clearMargin,
      );
    }
  });

  it("refuses to choose between Smith and Smyth", () => {
    const result = resolveName("Smith", ROSTER);

    expect(result.tier).toBe("ambiguous");
    expect(ids(result)).toEqual(
      expect.arrayContaining(["Jonah-Smith", "Emma-Smyth"]),
    );
  });

  it("refuses to choose between Chen, Chan and Chin", () => {
    const result = resolveName("Chen", ROSTER);

    expect(result.tier).toBe("ambiguous");
    expect(ids(result)).toEqual(
      expect.arrayContaining(["Nora-Chen", "Hana-Chan", "Ethan-Chin"]),
    );
  });

  it("refuses to choose between Lee and Li", () => {
    const result = resolveName("Lee", ROSTER);

    expect(result.tier).toBe("ambiguous");
    expect(ids(result)).toEqual(
      expect.arrayContaining(["Grace-Lee", "Charlotte-Li"]),
    );
  });

  it("refuses to choose between Nunez and Nunes", () => {
    const result = resolveName("Nunez", ROSTER);

    expect(result.tier).toBe("ambiguous");
    expect(ids(result)).toEqual(
      expect.arrayContaining(["Isabella-Núñez", "Caleb-Nunes"]),
    );
  });

  it("separates Marsh from Marchetti", () => {
    const result = resolveName("Marsh", ROSTER);

    expect(result.tier).toBe("clear");
    expect(ids(result)[0]).toBe("Ava-Marsh");
  });

  it("separates Garcia from Garza", () => {
    const result = resolveName("Garcia", ROSTER);

    expect(result.tier).toBe("clear");
    expect(ids(result)[0]).toBe("Sofia-García");
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
    const result = resolveName("Nguyen", ROSTER);

    expect(result.tier).toBe("ambiguous");
    expect(ids(result)).toEqual(
      expect.arrayContaining(["Layla-Nguyen", "Minh-Nguyen"]),
    );
  });

  it("uses a spoken first name to settle a shared surname", () => {
    const result = resolveName("Layla Nguyen", ROSTER);

    expect(result.tier).toBe("clear");
    expect(ids(result)[0]).toBe("Layla-Nguyen");
  });

  it("matches a multi-word surname however the speaker spaces it", () => {
    for (const spoken of ["van der Berg", "Vanderberg"]) {
      const result = resolveName(spoken, ROSTER);
      expect(result.tier, spoken).toBe("clear");
      expect(ids(result)[0], spoken).toBe("Mia-van der Berg");
    }
  });
});

describe("resolveName — Deepgram alternatives", () => {
  it("matches on an alias and says so", () => {
    // "Eng" is nothing like the spelling "Ng"; only the alias list connects them.
    const result = resolveName("Eng", ROSTER);

    expect(ids(result)[0]).toBe("Theo-Ng");
    expect(result.candidates[0].matchedVia).toBe("alias");
    expect(result.candidates[0].matchedOn).toBe("Eng");
  });

  it("matches a punctuated surname however the speaker runs it together", () => {
    expect(ids(resolveName("Alrashid", ROSTER))[0]).toBe("Amira-Al-Rashid");
  });

  it("ranks a more confident alternative first but still refuses to choose", () => {
    // Two alternatives that are each an exact roster hit is precisely the case
    // where a confident guess would put the wrong child on a teacher's screen.
    const result = resolveName(
      [
        { transcript: "Cowan", confidence: 0.9 },
        { transcript: "Cohen", confidence: 0.5 },
      ],
      ROSTER,
    );

    expect(ids(result)[0]).toBe("Owen-Cowan");
    expect(result.tier).toBe("ambiguous");
  });

  it("can match on a later alternative when the first is nonsense", () => {
    const result = resolveName(
      [
        { transcript: "mmm", confidence: 0.2 },
        { transcript: "Marchetti", confidence: 0.8 },
      ],
      ROSTER,
    );

    expect(result.tier).toBe("clear");
    expect(ids(result)[0]).toBe("Samuel-Marchetti");
  });

  it("reports the alternative the top candidate came from, for the audit log", () => {
    const result = resolveName(
      [
        { transcript: "mmm", confidence: 0.2 },
        { transcript: "Marchetti", confidence: 0.8 },
      ],
      ROSTER,
    );

    expect(result.transcript).toBe("Marchetti");
  });
});

describe("resolveName — names that are not on the roster at all", () => {
  // Every other test in this file says a roster name into the roster. That left
  // the direction that actually hurts untested: a surname nobody here has,
  // confidently matched to a child who is. A wrong "clear" pre-highlights the
  // wrong name; these must never reach that tier.
  const strangers: Array<[transcript: string, wouldHaveMatched: string]> = [
    ["Cruz", "Garza"],
    ["Berg", "Brook"],
    ["Bryce", "Brook"],
    ["Burke", "Brook"],
    ["Brock", "Brook"],
    ["Gwen", "Cowan"],
    ["Nagy", "Ng"],
    ["Nah", "Yu"],
    ["Rao", "Rios"],
    ["Wang", "Ng"],
    ["Yang", "Ng"],
    ["Chung", "Chan"],
    ["Raman", "Rahman"],
    ["Rahmani", "Rahman"],
    ["Nasir", "Nair"],
    ["Rashad", "Al-Rashid"],
    ["Rashida", "Al-Rashid"],
    ["Sylvain", "Silva"],
    ["Yi", "Yu"],
    ["Ye", "Yu"],
    ["Yee", "Yu"],
    ["Shin", "Chin"],
    ["Lim", "Li"],
    ["Ha", "Oh"],
    ["Reed", "Reyes"],
    ["Ahmad", "Rahman"],
    ["Hamdan", "Rahman"],
    ["Price", "Patel"],
    ["Braun", "O'Brien"],
  ];

  it.each(strangers)("does not pre-highlight anyone for %s", (transcript) => {
    expect(resolveName(transcript, ROSTER).tier).not.toBe("clear");
  });

  it("does not pre-highlight a child when someone says oh", () => {
    // Deepgram emits interjections routinely. The grade filter makes this worse
    // by removing the actual Oh from the roster.
    const kindergarten = ROSTER.filter((student) =>
      [
        "Maya-Cohen",
        "Elias-Kohen",
        "Nora-Chen",
        "Theo-Ng",
        "Amira-Al-Rashid",
        "Jonah-Smith",
      ].includes(student.id),
    );

    expect(resolveName("Oh", kindergarten).tier).not.toBe("clear");
  });
});

describe("resolveName — a first name that does not belong to the surname", () => {
  // The coverage discount rewards a match for explaining more of what was said.
  // An inexact two-word match must not use that to outrank an exact surname.
  const mismatched: Array<[transcript: string, correct: string]> = [
    ["Maya Chen", "Nora-Chen"],
    ["Nora Chan", "Hana-Chan"],
    ["Nora Chin", "Ethan-Chin"],
    ["Maya Koen", "Zoe-Koen"],
    ["Harper Silvia", "Elena-Silvia"],
    ["Priya Patil", "Arjun-Patil"],
    ["Jonah Smyth", "Emma-Smyth"],
  ];

  it.each(mismatched)(
    "does not pre-highlight the wrong child for %s",
    (transcript) => {
      expect(resolveName(transcript, ROSTER).tier).not.toBe("clear");
    },
  );

  it("still ranks the child whose surname was actually said first", () => {
    expect(ids(resolveName("Maya Chen", ROSTER))[0]).toBe("Nora-Chen");
  });
});
