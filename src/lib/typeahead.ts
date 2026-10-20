/**
 * Live suggestions for /announce's search box, computed in the browser as the
 * staff member types.
 *
 * Deliberately local rather than a `resolve-name` call per keystroke: the
 * roster is already in memory for the class drawer (`use-class-roster.ts`), a
 * school roster is a few hundred names at most, and a linear scan over a
 * pre-normalized index costs microseconds -- where a request per keystroke
 * would cost a round trip each, and spend the per-device rate limit on
 * half-typed names. The server resolver is still one tap away (Search) for
 * what prefix matching cannot do: misspellings and sound-alikes.
 *
 * Pure and dependency-free, like `class-roster.ts`, so the ranking rules are
 * unit-tested (`typeahead.test.ts`) without rendering anything.
 *
 * Nothing here ever confirms anyone. A suggestion is a candidate button like
 * any other; a human still taps it.
 */

import type { ResolveCandidateLike } from "@/lib/announce-reducer";
import type { CandidateStudent, MatchTier, MatchedVia } from "@/lib/api";
import type { PadStudent } from "@/lib/class-roster";

/** The few carpool fields matching needs. */
export interface TypeaheadCarpool {
  id: string;
  name: string;
  aliases: string[];
}

/** One spelling a target can be found by, normalized once up front. */
interface IndexedName {
  /** Normalized, words joined by single spaces. */
  text: string;
  words: string[];
  /** The spelling as written, for `matchedOn`. */
  display: string;
  via: MatchedVia;
  /** Below 1 for spellings that are a slightly weaker signal, e.g. a nickname. */
  weight: number;
}

interface StudentEntry {
  kind: "student";
  student: PadStudent;
  names: IndexedName[];
  /** "last first", normalized: the tie-break order, A to Z by surname. */
  sortKey: string;
}

interface CarpoolEntry {
  kind: "carpool";
  carpool: TypeaheadCarpool;
  names: IndexedName[];
}

export interface TypeaheadIndex {
  students: StudentEntry[];
  carpools: CarpoolEntry[];
  /** Carpool id -> every member on the roster, A to Z. */
  members: Map<string, PadStudent[]>;
  carpoolsById: Map<string, TypeaheadCarpool>;
}

export interface Suggestions {
  tier: MatchTier;
  candidates: ResolveCandidateLike[];
}

/** How many suggestions to show. More than this stops fitting above a phone keyboard. */
export const SUGGESTION_LIMIT = 5;

/** Below this length a mid-word substring match is noise ("a" is in half the roster). */
const MIN_SUBSTRING_LENGTH = 3;

/**
 * Case-folds, strips diacritics and treats anything that is not a letter or
 * digit as a word break, so "O'Brien", "obrien" and "Ó Brien" all compare the
 * same way and a hyphenated surname can be found by either half.
 */
export function normalizeQuery(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function indexName(
  display: string,
  via: MatchedVia,
  weight: number,
): IndexedName | null {
  const text = normalizeQuery(display);
  if (text === "") return null;
  return { text, words: text.split(" "), display, via, weight };
}

function compact<T>(items: (T | null)[]): T[] {
  return items.filter((item): item is T => item !== null);
}

function byName(a: PadStudent, b: PadStudent): number {
  return (
    a.last_name.localeCompare(b.last_name, undefined, { sensitivity: "base" }) ||
    a.first_name.localeCompare(b.first_name, undefined, { sensitivity: "base" })
  );
}

/**
 * Built once per roster change (the caller memoises it), so each keystroke
 * only compares strings that are already normalized.
 */
export function buildTypeaheadIndex(
  roster: readonly PadStudent[],
  carpools: readonly TypeaheadCarpool[],
): TypeaheadIndex {
  const members = new Map<string, PadStudent[]>();
  for (const student of roster) {
    if (student.carpool_id === null) continue;
    const list = members.get(student.carpool_id) ?? [];
    list.push(student);
    members.set(student.carpool_id, list);
  }
  for (const list of members.values()) list.sort(byName);

  return {
    students: roster.map((student) => ({
      kind: "student",
      student,
      names: compact([
        indexName(student.last_name, "surname", 1),
        indexName(student.first_name, "full_name", 0.97),
        indexName(`${student.first_name} ${student.last_name}`, "full_name", 1),
        ...(student.aliases ?? []).map((alias) =>
          indexName(alias, "alias", 0.95),
        ),
      ]),
      sortKey: normalizeQuery(`${student.last_name} ${student.first_name}`),
    })),
    carpools: carpools.map((carpool) => ({
      kind: "carpool",
      carpool,
      names: compact([
        indexName(carpool.name, "surname", 1),
        ...carpool.aliases.map((alias) => indexName(alias, "alias", 0.95)),
      ]),
    })),
    members,
    carpoolsById: new Map(carpools.map((carpool) => [carpool.id, carpool])),
  };
}

/**
 * How well a typed query matches one spelling, 0 to 1. Ordered so that what
 * a person most likely meant ranks first: the whole name, then the start of
 * it, then the start of any word in it, then (for longer queries) anywhere.
 */
function scoreName(query: string, tokens: string[], name: IndexedName): number {
  let score = 0;
  if (name.text === query) score = 1;
  else if (name.text.startsWith(query)) score = 0.9;
  else if (
    tokens.length === 1
      ? name.words.some((word) => word.startsWith(query))
      : tokens.every((token) => name.words.some((word) => word.startsWith(token)))
  )
    score = 0.8;
  else if (query.length >= MIN_SUBSTRING_LENGTH && name.text.includes(query))
    score = 0.5;
  return score * name.weight;
}

interface BestMatch {
  score: number;
  name: IndexedName;
}

function bestMatch(
  query: string,
  tokens: string[],
  names: readonly IndexedName[],
): BestMatch | null {
  let best: BestMatch | null = null;
  for (const name of names) {
    const score = scoreName(query, tokens, name);
    if (score > 0 && (!best || score > best.score)) best = { score, name };
  }
  return best;
}

function toCandidateStudent(student: PadStudent): CandidateStudent {
  return {
    id: student.id,
    first_name: student.first_name,
    last_name: student.last_name,
    class_group: student.class_group,
    status: student.status,
  };
}

/**
 * One match before it becomes a candidate. Ranking happens on these, and only
 * the few that survive the cut are turned into candidate objects -- a short
 * query can match most of the roster, and building (and locale-sorting) a full
 * candidate for every one of them is what made a keystroke slow.
 */
interface Hit {
  score: number;
  match: BestMatch;
  /** Normalized, so a plain `<` sorts it. */
  sortKey: string;
  arrived: boolean;
  target:
    | { kind: "student"; student: PadStudent }
    | { kind: "carpool"; carpool: TypeaheadCarpool; riders: PadStudent[] };
}

function compareHits(a: Hit, b: Hit): number {
  return (
    b.score - a.score ||
    // Someone still waiting is far likelier to be who is at the kerb.
    Number(a.arrived) - Number(b.arrived) ||
    (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0)
  );
}

function toCandidate(hit: Hit): ResolveCandidateLike {
  const { target, match } = hit;
  return {
    students:
      target.kind === "student"
        ? [toCandidateStudent(target.student)]
        : target.riders.map(toCandidateStudent),
    carpool:
      target.kind === "carpool"
        ? { id: target.carpool.id, name: target.carpool.name }
        : null,
    score: match.score,
    matchedOn: match.name.display,
    matchedVia: match.name.via,
  };
}

/**
 * The suggestions for what has been typed so far.
 *
 * - A student who rides in a carpool is suggested as the whole carpool, the
 *   same collapse `resolve-name` does, so typing one sibling's first name
 *   offers the family. If the carpool's name is not known (the carpool list
 *   failed to load), the student is offered alone instead -- a carpool button
 *   must say whose carpool it is.
 * - `classGroups` narrows the pool the same way it narrows `resolve-name`. A
 *   carpool counts as in scope when any member is; its button still lists
 *   every member, because siblings in other classes ride in the same car.
 * - `clear` only when there is exactly one suggestion, which pre-highlights
 *   it. It still needs a tap.
 */
export function suggest(
  index: TypeaheadIndex,
  rawQuery: string,
  classGroups: readonly string[] = [],
  limit: number = SUGGESTION_LIMIT,
): Suggestions {
  const query = normalizeQuery(rawQuery);
  if (query === "") return { tier: "none", candidates: [] };
  const tokens = query.split(" ");

  const inScope = (student: PadStudent) =>
    classGroups.length === 0 ||
    (student.class_group !== null && classGroups.includes(student.class_group));

  const hits = new Map<string, Hit>();
  const offer = (key: string, hit: Hit) => {
    const existing = hits.get(key);
    if (!existing || hit.score > existing.score) hits.set(key, hit);
  };

  /** A carpool hit, or null when none of its riders are on offer. */
  const carpoolHit = (carpool: TypeaheadCarpool, match: BestMatch): Hit | null => {
    const riders = index.members.get(carpool.id) ?? [];
    if (riders.length === 0 || !riders.some(inScope)) return null;
    return {
      score: match.score,
      match,
      sortKey: normalizeQuery(carpool.name),
      arrived: riders.every((rider) => rider.status === "arrived"),
      target: { kind: "carpool", carpool, riders },
    };
  };

  for (const entry of index.students) {
    if (!inScope(entry.student)) continue;
    const match = bestMatch(query, tokens, entry.names);
    if (!match) continue;

    const carpool =
      entry.student.carpool_id !== null
        ? index.carpoolsById.get(entry.student.carpool_id)
        : undefined;
    if (carpool) {
      const grouped = carpoolHit(carpool, match);
      if (grouped) {
        offer(`carpool:${carpool.id}`, grouped);
        continue;
      }
    }
    offer(`student:${entry.student.id}`, {
      score: match.score,
      match,
      sortKey: entry.sortKey,
      arrived: entry.student.status === "arrived",
      target: { kind: "student", student: entry.student },
    });
  }

  for (const entry of index.carpools) {
    const match = bestMatch(query, tokens, entry.names);
    if (!match) continue;
    const hit = carpoolHit(entry.carpool, match);
    if (hit) offer(`carpool:${entry.carpool.id}`, hit);
  }

  const candidates = [...hits.values()]
    .sort(compareHits)
    .slice(0, limit)
    .map(toCandidate);

  return {
    tier:
      candidates.length === 0
        ? "none"
        : candidates.length === 1
          ? "clear"
          : "ambiguous",
    candidates,
  };
}
