/**
 * Keyterm list for Deepgram's Keyterm Prompting.
 *
 * Sending the roster's own surnames biases recognition toward the names that
 * can actually be said in this pickup line, which is most of what makes the
 * matcher's job tractable. The budget is small, so the ordering matters:
 *
 *   1. Each waiting student's own surname, immediately followed by their own
 *      parent name(s) -- a child and their parent are offered as a pair
 *      rather than as two separate categories, so truncation degrades by
 *      roster position (student N and their parent are either both in or
 *      both out) instead of by category. A flat "every surname, then every
 *      parent name" ordering was tried first and measured against the real
 *      105-student seed roster: with the whole school waiting and one parent
 *      name each, only 52 of 105 parent names survived the 100-term limit,
 *      and WHICH 52 was decided purely by alphabetical last-name order --
 *      the boost the feature depends on silently wasn't there for roughly
 *      half the roster, with no signal anywhere that it had happened.
 *   2. Carpool names -- a name someone might say directly, to call several
 *      children at once. This is a deliberate trade: a family whose parent
 *      name would have fit under the old ordering can now be pushed out by
 *      a carpool name instead, but a parent's own name is offered exactly
 *      when their own child's surname is, which matters more than exactly
 *      which category runs out first once the roster is large enough to
 *      truncate at all.
 *   3. Surnames of students already picked up -- for a correction or an undo.
 *   4. Alternate spellings, if there is room left.
 *
 * The list is meant to be narrowed further by the class filter on the
 * announce page; the caller passes an already-filtered roster. Carpools are
 * not filtered the same way (a carpool can span classes), so every carpool
 * name is offered regardless of the roster filter.
 */

/** Deepgram's self-serve Keyterm Prompting is documented up to ~100 terms. */
export const KEYTERM_LIMIT = 100;

export interface KeytermStudent {
  last_name: string;
  aliases: string[];
  status: "waiting" | "arrived";
  parent1_name: string | null;
  parent2_name: string | null;
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

  /** A student's own surname immediately followed by their own parent name(s). */
  const surnameAndParents = (student: KeytermStudent): string[] => [
    student.last_name,
    ...[student.parent1_name, student.parent2_name].filter(
      (name): name is string => name !== null && name.trim() !== "",
    ),
  ];

  const tiers = [
    waiting.flatMap(surnameAndParents),
    carpools.map((carpool) => carpool.name),
    arrived.flatMap(surnameAndParents),
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
