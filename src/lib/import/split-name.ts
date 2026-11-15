/**
 * Splits one "full name" cell into a first and last name.
 *
 * A comma always means "Last, First" -- that is how a school export writes it
 * and nobody types a comma inside a first name. Without a comma the admin's
 * chosen order applies, defaulting to "First Last".
 */

export type NameOrder = "first-last" | "last-first";

export interface SplitName {
  first_name: string;
  last_name: string;
}

/**
 * Lowercase words that belong to the surname that follows them ("van der
 * Berg", "ben David", "de la Cruz").
 */
const SURNAME_PARTICLES = new Set([
  "van",
  "von",
  "der",
  "den",
  "de",
  "del",
  "della",
  "la",
  "le",
  "da",
  "di",
  "du",
  "ben",
  "bat",
  "bar",
  "bin",
  "ibn",
  "al",
  "el",
  "st",
  "st.",
]);

/** Generational suffixes that stay attached to the surname. */
const SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv"]);

function isParticle(word: string): boolean {
  return SURNAME_PARTICLES.has(word.toLowerCase());
}

/** @returns null when the cell does not hold two names to split. */
export function splitFullName(
  raw: string,
  order: NameOrder = "first-last",
): SplitName | null {
  const cleaned = raw.trim().replace(/\s+/g, " ");
  if (cleaned === "") return null;

  const comma = cleaned.indexOf(",");
  if (comma !== -1) {
    const last = cleaned.slice(0, comma).trim();
    const first = cleaned
      .slice(comma + 1)
      .replace(/,/g, " ")
      .trim();
    return last && first ? { first_name: first, last_name: last } : null;
  }

  const words = cleaned.split(" ");
  if (words.length < 2) return null;

  if (order === "last-first") {
    // Take leading particles with the surname: "van Berg Anna".
    let end = 1;
    while (end < words.length - 1 && isParticle(words[end - 1])) end++;
    return {
      last_name: words.slice(0, end).join(" "),
      first_name: words.slice(end).join(" "),
    };
  }

  let start = words.length - 1;
  if (SUFFIXES.has(words[start].toLowerCase()) && start >= 2) start--;
  while (start > 1 && isParticle(words[start - 1])) start--;
  return {
    first_name: words.slice(0, start).join(" "),
    last_name: words.slice(start).join(" "),
  };
}
