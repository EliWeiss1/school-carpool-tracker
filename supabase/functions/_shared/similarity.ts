/**
 * Jaro-Winkler string distance.
 *
 * Chosen over Levenshtein because surnames are short and their first syllable
 * carries most of the identity: Winkler's prefix bonus rewards exactly that,
 * and Jaro's transposition tolerance covers the letter swaps a hurried typist
 * or a transcriber makes ("Reyes" / "Reyse").
 *
 * Zero dependencies so the file runs unchanged in Deno and in Node.
 */

/** Winkler's standard prefix weight. Above 0.25 the score can exceed 1. */
const PREFIX_WEIGHT = 0.1;

/** Only the first four characters earn the prefix bonus, as Winkler defined it. */
const MAX_PREFIX = 4;

/** Proportion of matching characters, discounting transpositions. */
function jaro(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  // Two characters count as matching only if they are near each other; without
  // this window every long name would partially match every other.
  const window = Math.max(Math.floor(Math.max(a.length, b.length) / 2) - 1, 0);

  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);
  let matches = 0;

  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - window);
    const end = Math.min(i + window + 1, b.length);

    for (let j = start; j < end; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  // Matched characters that appear in a different order are half a mismatch.
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }

  const half = transpositions / 2;
  return (
    (matches / a.length + matches / b.length + (matches - half) / matches) / 3
  );
}

/** Jaro, boosted when the two strings open with the same characters. Range 0-1. */
export function jaroWinkler(a: string, b: string): number {
  const base = jaro(a, b);
  if (base === 0) return 0;

  let prefix = 0;
  const limit = Math.min(MAX_PREFIX, a.length, b.length);
  while (prefix < limit && a[prefix] === b[prefix]) prefix++;

  return base + prefix * PREFIX_WEIGHT * (1 - base);
}
