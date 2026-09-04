/**
 * Keyterm list for Deepgram's Keyterm Prompting.
 *
 * Sending the roster's own surnames biases recognition toward the names that
 * can actually be said in this pickup line, which is most of what makes the
 * matcher's job tractable. The budget is small, so the ordering matters:
 *
 *   1. Surnames of students still waiting -- the only names anyone can announce.
 *   2. Carpool names -- a name someone might say directly, to call several
 *      children at once, but it never gets said MORE often than a waiting
 *      child's own surname, so it sits just behind them.
 *   3. Surnames of students already picked up -- for a correction or an undo.
 *   4. Alternate spellings, if there is room left.
 *
 * The list is meant to be narrowed further by the grade/class filter on the
 * announce page; the caller passes an already-filtered roster. Carpools are
 * not filtered the same way (a carpool can span grades), so every carpool
 * name is offered regardless of the roster filter.
 */

/** Deepgram's self-serve Keyterm Prompting is documented up to ~100 terms. */
export const KEYTERM_LIMIT = 100;

export interface KeytermStudent {
  last_name: string;
  aliases: string[];
  status: "waiting" | "arrived";
}

export interface KeytermCarpool {
  name: string;
  aliases: string[];
}

export function buildKeyterms(
  students: KeytermStudent[],
  carpools: KeytermCarpool[] = [],
  options: { limit?: number } = {},
): string[] {
  const limit = options.limit ?? KEYTERM_LIMIT;

  const waiting = students.filter((student) => student.status === "waiting");
  const arrived = students.filter((student) => student.status !== "waiting");

  const tiers = [
    waiting.map((student) => student.last_name),
    carpools.map((carpool) => carpool.name),
    arrived.map((student) => student.last_name),
    [
      ...students.flatMap((student) => student.aliases),
      ...carpools.flatMap((carpool) => carpool.aliases),
    ],
  ];

  // One term per spelling: Deepgram gains nothing from a repeated keyterm, and
  // two Nguyens would otherwise cost two slots out of a hundred.
  const seen = new Set<string>();
  const terms: string[] = [];

  for (const tier of tiers) {
    for (const raw of tier) {
      if (terms.length >= limit) return terms;

      const term = raw.trim();
      const key = term.toLowerCase();
      if (term === "" || seen.has(key)) continue;

      seen.add(key);
      terms.push(term);
    }
  }

  return terms;
}
