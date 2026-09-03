/**
 * Transcript -> roster resolver.
 *
 * This is the component where a mistake is most expensive: its output decides
 * which child's name a teacher sees turn green. So it never returns a decision,
 * only a ranked opinion plus a tier saying how much that opinion is worth. The
 * caller always requires a human tap.
 *
 * The scoring pipeline, in order:
 *   1. Fold both sides to comparison keys (see normalize.ts).
 *   2. Score every transcript phrase against every roster key with
 *      Jaro-Winkler, floored upward when the two share a phonetic code.
 *   3. Weight by which key matched (an alias is very good evidence, not perfect)
 *      and by how confident Deepgram was in that alternative.
 *   4. Discount a match that explains less of the transcript than the best one
 *      does, so "Layla Nguyen" beats the other Nguyen while a bare "Nguyen"
 *      still cannot separate them.
 *   5. Apply the tier policy below.
 */

import { compareKey, phraseCandidates, tokenize } from "./normalize.ts";
import { phoneticCode } from "./phonetic.ts";
import { jaroWinkler } from "./similarity.ts";

/** How much weight the announce screen may put on the top candidate. */
export type MatchTier = "clear" | "ambiguous" | "none";

/** Which of a student's names the transcript actually looked like. */
export type MatchedVia = "surname" | "alias" | "full_name";

/** The roster fields the resolver needs. Callers may pass richer rows. */
export interface ResolverStudent {
  id: string;
  first_name: string;
  last_name: string;
  aliases: string[];
}

/** One Deepgram hypothesis, with its own 0-1 estimate of itself. */
export interface TranscriptAlternative {
  transcript: string;
  confidence?: number;
}

export interface Candidate<T extends ResolverStudent> {
  student: T;
  /** 0-1. Logged verbatim as status_events.match_confidence. */
  score: number;
  /** The spelling that matched, as written on the roster, for the audit trail. */
  matchedOn: string;
  matchedVia: MatchedVia;
}

export interface ResolveResult<T extends ResolverStudent> {
  tier: MatchTier;
  /** Ranked best first. Empty when the tier is "none". */
  candidates: Candidate<T>[];
  /** The alternative the top candidate came from, unfolded, for the audit log. */
  transcript: string;
}

/**
 * Every number the matcher's behaviour depends on, in one place, because these
 * are meant to be retuned from real status_events data rather than argued about.
 *
 * The asymmetry to keep in mind: a needless "ambiguous" costs one extra tap, a
 * wrong "clear" puts the wrong child's name on a teacher-facing board. When in
 * doubt these move toward showing more candidates, not fewer.
 */
export const MATCH_POLICY = Object.freeze({
  /** Below this a student is not offered at all. */
  minCandidate: 0.72,
  /**
   * A "clear" match must reach this on its own...
   *
   * 0.88, not 0.80: Jaro alone scores a single substitution in a four-letter
   * surname at 0.833, which made Shin a confident Chin and Reed a confident
   * Reyes. Every correct clear match observed against the seed roster is an
   * exact key hit scoring 1.0, so this costs nothing real.
   */
  clearScore: 0.88,
  /** ...and beat the runner-up by this much. Otherwise both are shown equally. */
  clearMargin: 0.07,
  /** The announce screen has room for three large tap targets. */
  maxCandidates: 3,
  /**
   * An alias is a known alternate spelling: strong evidence, but the roster
   * spelling is stronger, so an exact surname hit outranks an exact alias hit.
   */
  aliasWeight: 0.98,
  /** Sharing a phonetic code lifts a score to at least this before distance. */
  phoneticFloor: 0.8,
  /**
   * How close in length two names must be before length stops counting against
   * them. Jaro rates a short key generously against a long string -- every
   * letter of the alias "Win" appears somewhere in "Washington" -- so without
   * this the roster's two- and three-letter surnames match almost anything.
   */
  lengthFloor: 0.5,
  /**
   * Shortest name, in letters, for which an inexact match may still be called
   * clear. Below this a single edit is too large a share of the word for string
   * distance to be evidence: Lim scores 0.91 against Li, Wang 0.90 against the
   * alias Ang, Nasir 0.95 against Nair. Short names must match exactly to be
   * pre-highlighted; they can still be offered as candidates.
   */
  minInexactClearLength: 6,
  /** How much a match is discounted for explaining less of the transcript. */
  coverageWeight: 0.2,
  /** How much of the score Deepgram's own confidence in an alternative moves. */
  confidenceWeight: 0.1,
  /** "van der Berg" is three spoken words; nothing on the roster is longer. */
  maxPhraseWords: 3,
});

interface RosterKey {
  key: string;
  code: string;
  /** The spelling as the roster writes it. */
  label: string;
  via: MatchedVia;
  weight: number;
}

interface BestMatch {
  score: number;
  /** How many transcript words the matching phrase consumed. */
  words: number;
  exact: boolean;
  viaPhonetic: boolean;
  length: number;
  label: string;
  via: MatchedVia;
  transcript: string;
}

/** Surname, aliases and first-plus-last, deduped so the strongest key wins. */
function rosterKeys(student: ResolverStudent): RosterKey[] {
  const drafts: Array<Omit<RosterKey, "code">> = [
    {
      key: compareKey(student.last_name),
      label: student.last_name,
      via: "surname",
      weight: 1,
    },
    {
      key: compareKey(`${student.first_name} ${student.last_name}`),
      label: `${student.first_name} ${student.last_name}`,
      via: "full_name",
      weight: 1,
    },
    ...student.aliases.map((alias) => ({
      key: compareKey(alias),
      label: alias,
      via: "alias" as const,
      weight: MATCH_POLICY.aliasWeight,
    })),
  ];

  // An alias spelled like the surname (Al-Rashid / Alrashid) folds to the same
  // key; keep the surname, which carries the heavier weight and the real label.
  const strongest = new Map<string, Omit<RosterKey, "code">>();
  for (const draft of drafts) {
    if (draft.key === "") continue;
    const existing = strongest.get(draft.key);
    if (!existing || draft.weight > existing.weight)
      strongest.set(draft.key, draft);
  }

  return [...strongest.values()].map((draft) => ({
    ...draft,
    code: phoneticCode(draft.key),
  }));
}

interface KeyMatch {
  score: number;
  /** The phrase *is* this key, letter for letter after folding. */
  exact: boolean;
  /** The score depended on the two names sharing a phonetic code. */
  viaPhonetic: boolean;
  /** Letters in the shorter of the two names -- how much there was to compare. */
  length: number;
}

/**
 * How much one folded phrase looks like one folded roster key, 0-1.
 *
 * Phonetic agreement raises the floor rather than replacing the distance: Cohen
 * and Koen share a code and must both score high, but they should not score
 * identically -- string distance still decides the order inside the group.
 *
 * Whether the floor was used is carried out of here, because a score that only
 * exists because two names sound alike is not evidence enough to pre-highlight
 * one of them. Cruz and Garza share a code; so do Berg and Brook.
 */
function keyScore(
  phrase: string,
  phraseCode: string,
  key: RosterKey,
): KeyMatch {
  const length = Math.min(phrase.length, key.key.length);

  if (phrase === key.key) {
    return { score: 1, exact: true, viaPhonetic: false, length };
  }

  const distance = jaroWinkler(phrase, key.key);
  const agreement = lengthAgreement(phrase, key.key);
  const sharesCode = phraseCode !== "" && phraseCode === key.code;

  const raw = sharesCode
    ? MATCH_POLICY.phoneticFloor + (1 - MATCH_POLICY.phoneticFloor) * distance
    : distance;

  return {
    score: raw * agreement,
    exact: false,
    viaPhonetic: sharesCode,
    length,
  };
}

/** Damps a score when one name is far shorter than the other. 0-1. */
function lengthAgreement(a: string, b: string): number {
  const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
  return ratio >= MATCH_POLICY.lengthFloor
    ? 1
    : ratio / MATCH_POLICY.lengthFloor;
}

/** Deepgram's confidence nudges a score; it never decides the match. */
function alternativeWeight(confidence: number | undefined): number {
  const clamped = Math.min(Math.max(confidence ?? 1, 0), 1);
  return (
    1 - MATCH_POLICY.confidenceWeight + MATCH_POLICY.confidenceWeight * clamped
  );
}

/** A match explaining fewer spoken words than the best one is discounted. */
function coverageFactor(words: number, bestWords: number): number {
  const coverage = Math.min(words / bestWords, 1);
  return (
    1 - MATCH_POLICY.coverageWeight + MATCH_POLICY.coverageWeight * coverage
  );
}

function toAlternatives(
  input: string | TranscriptAlternative[],
): TranscriptAlternative[] {
  return typeof input === "string" ? [{ transcript: input }] : input;
}

export function resolveName<T extends ResolverStudent>(
  input: string | TranscriptAlternative[],
  roster: T[],
  options: { maxCandidates?: number } = {},
): ResolveResult<T> {
  const alternatives = toAlternatives(input);
  const maxCandidates = options.maxCandidates ?? MATCH_POLICY.maxCandidates;
  const fallbackTranscript = alternatives[0]?.transcript ?? "";

  if (roster.length === 0 || alternatives.length === 0) {
    return { tier: "none", candidates: [], transcript: fallbackTranscript };
  }

  // Phrases and their phonetic codes are computed once and reused across the
  // whole roster: a few hundred students times a handful of keys each is
  // otherwise a lot of repeated coding for no new information.
  const phrases = alternatives.flatMap((alternative) => {
    const tokens = tokenize(alternative.transcript);
    const weight = alternativeWeight(alternative.confidence);

    return phraseCandidates(tokens, MATCH_POLICY.maxPhraseWords)
      .filter((phrase) => phrase.text !== "")
      .map((phrase) => ({
        text: phrase.text,
        code: phoneticCode(phrase.text),
        words: phrase.words,
        weight,
        transcript: alternative.transcript,
      }));
  });

  const plausible: Array<{ student: T; match: BestMatch }> = [];

  for (const student of roster) {
    let winner: BestMatch | null = null;

    for (const key of rosterKeys(student)) {
      for (const phrase of phrases) {
        const match = keyScore(phrase.text, phrase.code, key);
        const score = match.score * key.weight * phrase.weight;

        const isBetter =
          winner === null ||
          score > winner.score + Number.EPSILON ||
          // On a tie, prefer the match that explains more of what was said:
          // "Layla Nguyen" is a better account of the audio than "Nguyen".
          (Math.abs(score - winner.score) <= Number.EPSILON &&
            phrase.words > winner.words);

        if (isBetter) {
          winner = {
            score,
            words: phrase.words,
            exact: match.exact,
            viaPhonetic: match.viaPhonetic,
            length: match.length,
            label: key.label,
            via: key.via,
            transcript: phrase.transcript,
          };
        }
      }
    }

    if (winner !== null && winner.score >= MATCH_POLICY.minCandidate) {
      plausible.push({ student, match: winner });
    }
  }

  // Coverage is measured against the best *plausible* match rather than against
  // the transcript length, so filler words ("uh, Cohen please") cost nothing.
  //
  // Only an exact key hit sets the bar. Otherwise "Maya Chen" -- a first name
  // from one child and a surname from another -- lets an approximate two-word
  // match discount the child whose surname was actually said, and pre-highlight
  // the wrong one. A match has to *be* a roster spelling before it earns the
  // right to penalise everyone who explained less.
  const bestWords = plausible.reduce(
    (max, entry) =>
      entry.match.exact ? Math.max(max, entry.match.words) : max,
    1,
  );

  const ranked = plausible
    .map(({ student, match }) => ({
      student,
      score: match.score * coverageFactor(match.words, bestWords),
      matchedOn: match.label,
      matchedVia: match.via,
      transcript: match.transcript,
      viaPhonetic: match.viaPhonetic,
      clearEligible:
        match.exact || match.length >= MATCH_POLICY.minInexactClearLength,
    }))
    .filter((candidate) => candidate.score >= MATCH_POLICY.minCandidate)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCandidates);

  if (ranked.length === 0) {
    return { tier: "none", candidates: [], transcript: fallbackTranscript };
  }

  const [top, runnerUp] = ranked;
  const margin = top.score - (runnerUp?.score ?? 0);

  // Four independent reasons to withhold a pre-highlight: not similar enough,
  // too close to the runner-up, similar only in sound, or too short a name for
  // an inexact match to mean anything. Cruz does not become Garza; Lim does not
  // become Li. Any of them still leaves the child on screen as a tap target.
  const tier: MatchTier =
    top.score >= MATCH_POLICY.clearScore &&
    margin >= MATCH_POLICY.clearMargin &&
    !top.viaPhonetic &&
    top.clearEligible
      ? "clear"
      : "ambiguous";

  return {
    tier,
    candidates: ranked.map(
      ({
        transcript: _fromAlternative,
        viaPhonetic: _viaPhonetic,
        clearEligible: _clearEligible,
        ...candidate
      }) => candidate,
    ),
    transcript: top.transcript,
  };
}
