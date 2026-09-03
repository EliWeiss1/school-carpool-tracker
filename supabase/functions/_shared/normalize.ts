/**
 * Text folding shared by the resolver and the keyterm builder.
 *
 * Runtime-neutral on purpose: this file is imported by the Deno Edge Functions
 * *and* by Vitest under Node, so it uses nothing but the JS standard library and
 * `.ts` import specifiers that both resolvers accept.
 *
 * The display name is never folded — `students.last_name` keeps its diacritics,
 * apostrophes and capitals. Folding exists only to build comparison keys.
 */

/**
 * Letters that NFD will not decompose into "base letter + combining mark", so
 * they need an explicit spelling. Restricted to forms that actually turn up in
 * surnames; anything missing simply falls through as-is.
 */
const IRREDUCIBLE_LETTERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/ß/g, "ss"],
  [/æ/g, "ae"],
  [/œ/g, "oe"],
  [/ø/g, "o"],
  [/å/g, "a"],
  [/đ|ð/g, "d"],
  [/ł/g, "l"],
  [/þ/g, "th"],
];

/** Combining marks left behind by NFD decomposition. */
const COMBINING_MARKS = /[̀-ͯ]/g;

/** Anything that is not an ASCII letter is a word separator, not a character. */
const NON_LETTER = /[^a-z]+/g;

/**
 * Case-fold, strip diacritics, and reduce punctuation to spaces.
 *
 * Punctuation becomes a separator rather than disappearing: "Al-Rashid" is two
 * spoken words, and collapsing it to one here would hide that from the tokenizer.
 * `compareKey` is where separators finally go away.
 */
export function foldName(input: string): string {
  let folded = input
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase();

  for (const [pattern, replacement] of IRREDUCIBLE_LETTERS) {
    folded = folded.replace(pattern, replacement);
  }

  return folded.replace(NON_LETTER, " ").trim();
}

/**
 * The key two names are actually compared on: folded, with every separator
 * removed. "van der Berg", "Van Der Berg" and "vanderberg" all reduce to one key,
 * so how a speaker spaces a name cannot decide a match.
 */
export function compareKey(input: string): string {
  return foldName(input).replace(/ /g, "");
}

/** Split a transcript into folded words. */
export function tokenize(input: string): string[] {
  const folded = foldName(input);
  return folded === "" ? [] : folded.split(" ");
}

/** A run of transcript words, joined into one comparison key. */
export interface Phrase {
  text: string;
  /** How many spoken words the key came from. */
  words: number;
}

/**
 * Every contiguous run of up to `maxWords` tokens, as a comparison key.
 *
 * A transcript is rarely just a surname -- it is "uh, van der Berg" or "Layla
 * Nguyen". Scoring each run separately lets a multi-word surname or a
 * first-plus-last name match without the surrounding filler dragging the score
 * down. The word count travels with the key because the resolver rewards a
 * match that explains more of what was said, and a joined key can no longer be
 * split back apart. Ordered shortest run first.
 */
export function phraseCandidates(tokens: string[], maxWords = 3): Phrase[] {
  const phrases: Phrase[] = [];

  for (let width = 1; width <= maxWords; width++) {
    for (let start = 0; start + width <= tokens.length; start++) {
      phrases.push({
        text: tokens.slice(start, start + width).join(""),
        words: width,
      });
    }
  }

  return phrases;
}
