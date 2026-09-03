/**
 * A surname-tuned phonetic coder.
 *
 * Deliberately not Double Metaphone. This file has to run unchanged in Deno
 * (inside the Edge Function) and in Vitest under Node, and a shared npm
 * dependency makes that resolution awkward for the sake of rules we only need a
 * narrow slice of. It is also easier to defend a table we can read than a
 * library's century of English-specific exceptions.
 *
 * The rule that earns its keep is folding C/K/Q onto one onset class: it is what
 * makes Cohen / Kohen / Koen / Coen collapse to a single code so the resolver
 * reports them as ambiguous instead of confidently picking one. Cowan stays out
 * of that group because its W survives — same onset, different word.
 *
 * The code is intentionally lossy about vowels (only a leading one survives) and
 * about the voiced/voiceless distinction inside a sibilant or fricative pair,
 * which are exactly the contrasts a phone mic in a parking lot loses. String
 * distance, not this code, is what separates names inside a phonetic group.
 */

import { compareKey } from "./normalize.ts";

/** Consonants with no digraph behaviour, mapped straight onto a sound class. */
const SIMPLE: Readonly<Record<string, string>> = {
  b: "B",
  d: "D",
  f: "F",
  // G is its own class, not part of C/K/Q: folding them merged Gwen into Cowan
  // and Nagy into Ng, which are different words to any listener.
  g: "G",
  j: "J",
  k: "K",
  l: "L",
  m: "M",
  n: "N",
  p: "P",
  q: "K",
  r: "R",
  s: "S",
  t: "T",
  v: "F", // V and F are one class: Silva / Silvia, Stephen / Steven.
  w: "W",
  z: "S", // S and Z are one class: Nunez / Nunes, Reyes / Reyez.
};

const VOWELS = "aeiou";

/** Silent first letters. "Knight" and "Night" are the same word to a listener. */
const SILENT_ONSETS = ["kn", "gn", "pn", "wr"];

/**
 * Reduce a name to its sound class sequence. Two names sharing a code are
 * plausible homophones; they are not necessarily the same name.
 */
export function phoneticCode(input: string): string {
  let key = compareKey(input);
  if (key === "") return "";

  if (SILENT_ONSETS.includes(key.slice(0, 2))) {
    key = key.slice(1);
  }

  let code = "";

  for (let i = 0; i < key.length; i++) {
    const char = key[i];
    const next = key[i + 1] ?? "";
    const isFirst = i === 0;

    // A doubled letter is one sound: Patell / Patel, Chinn / Chin.
    if (char === key[i - 1]) continue;

    if (VOWELS.includes(char)) {
      // Only a leading vowel survives. Anywhere else it is the contrast a
      // microphone loses first, and dropping it is what lets Patel meet Patil.
      if (isFirst) code += char.toUpperCase();
      continue;
    }

    switch (char) {
      case "c":
        if (next === "h") {
          code += "X";
          i++;
        } else if (next === "k") {
          code += "K";
          i++;
        } else {
          code += "K";
        }
        continue;
      case "s":
        code += "S";
        if (next === "h") i++; // SH is one sound, and S already covers it.
        continue;
      case "p":
        code += next === "h" ? "F" : "P";
        if (next === "h") i++;
        continue;
      case "t":
        code += "T";
        if (next === "h") i++; // TH: Smith and Smyth are the same word.
        continue;
      case "g":
        if (next === "h") {
          // Silent unless it opens the name: Leigh is Lee, but Ghosh is not Osh.
          if (isFirst) code += "G";
          i++;
          continue;
        }
        code += "G";
        continue;
      case "h":
        // Silent between or after vowels — which, the digraphs above having
        // been consumed, is everywhere but the front of the name.
        if (isFirst) code += "H";
        continue;
      case "w":
        code += "W";
        if (isFirst && next === "h") i++;
        continue;
      case "x":
        code += isFirst ? "S" : "KS";
        continue;
      case "y":
        // A consonant only at the front ("Yu"); a vowel, and so dropped, after.
        if (isFirst) code += "Y";
        continue;
      default:
        code += SIMPLE[char] ?? "";
        continue;
    }
  }

  return code;
}
