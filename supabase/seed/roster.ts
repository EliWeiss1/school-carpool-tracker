/**
 * Sample roster for local development. Not real students.
 *
 * The surnames are chosen adversarially: every cluster below is a pair or trio
 * that a speech recogniser routinely confuses, so `npm run seed` gives the
 * matcher (phase 3) and the /display grid (phase 5) something genuinely hard to
 * work against rather than 36 unambiguous names.
 *
 * Clusters in here:
 *   Cohen / Kohen / Koen / Cowan   — the canonical hard case
 *   Chen / Chan / Chin             — one-vowel separation
 *   Lee / Li / Leigh               — homophones, different spellings
 *   Reyes / Rios, Garcia / Garza   — same onset, diverging tail
 *   Patel / Patil, Silva / Silvia  — one-character edits
 *   Smith / Smyth                  — identical phonetics, different spelling
 *   Nunez / Nunes                  — plus a diacritic on one of them
 *   Marsh / Marchetti              — prefix containment
 *   Brooks / Brook                 — plural vs singular
 *   Nguyen x2                      — same surname, forces first-name disambiguation
 *   Ng / Oh / Yu                   — very short surnames, where a single edit is
 *                                    a huge proportion of the string
 *   Al-Rashid / O'Brien / D'Angelo / van der Berg / García / Núñez
 *                                  — punctuation, spaces, particles, diacritics
 */

export interface SampleStudent {
  first_name: string;
  last_name: string;
  aliases: string[];
  grade: string;
  class_group: string;
}

export const SAMPLE_ROSTER: SampleStudent[] = [
  // --- Kindergarten ---
  {
    first_name: "Maya",
    last_name: "Cohen",
    aliases: ["Kohen", "Cohn"],
    grade: "K",
    class_group: "K-Alvarez",
  },
  {
    first_name: "Elias",
    last_name: "Kohen",
    aliases: ["Cohen"],
    grade: "K",
    class_group: "K-Alvarez",
  },
  {
    first_name: "Nora",
    last_name: "Chen",
    aliases: ["Chan"],
    grade: "K",
    class_group: "K-Alvarez",
  },
  {
    first_name: "Theo",
    last_name: "Ng",
    aliases: ["Eng", "Ang"],
    grade: "K",
    class_group: "K-Alvarez",
  },
  {
    first_name: "Amira",
    last_name: "Al-Rashid",
    aliases: ["Alrashid", "Al Rashid", "Rashid"],
    grade: "K",
    class_group: "K-Alvarez",
  },
  {
    first_name: "Jonah",
    last_name: "Smith",
    aliases: ["Smyth"],
    grade: "K",
    class_group: "K-Alvarez",
  },

  // --- Grade 1 ---
  {
    first_name: "Lucia",
    last_name: "Reyes",
    aliases: ["Reyez", "Rayes"],
    grade: "1",
    class_group: "1-Brennan",
  },
  {
    first_name: "Diego",
    last_name: "Rios",
    aliases: ["Reos", "Rio"],
    grade: "1",
    class_group: "1-Brennan",
  },
  {
    first_name: "Priya",
    last_name: "Patel",
    aliases: ["Patell"],
    grade: "1",
    class_group: "1-Brennan",
  },
  {
    first_name: "Arjun",
    last_name: "Patil",
    aliases: ["Pateel"],
    grade: "1",
    class_group: "1-Brennan",
  },
  {
    first_name: "Grace",
    last_name: "Lee",
    aliases: ["Leigh"],
    grade: "1",
    class_group: "1-Brennan",
  },
  {
    first_name: "Owen",
    last_name: "Cowan",
    aliases: ["Cowen", "Kowan"],
    grade: "1",
    class_group: "1-Brennan",
  },

  // --- Grade 2 ---
  {
    first_name: "Sofia",
    last_name: "García",
    aliases: ["Garcia"],
    grade: "2",
    class_group: "2-Cho",
  },
  {
    first_name: "Mateo",
    last_name: "Garza",
    aliases: ["Garsa"],
    grade: "2",
    class_group: "2-Cho",
  },
  {
    first_name: "Hana",
    last_name: "Chan",
    aliases: ["Chang"],
    grade: "2",
    class_group: "2-Cho",
  },
  {
    first_name: "Liam",
    last_name: "O'Brien",
    aliases: ["OBrien", "O Brien", "Obrian"],
    grade: "2",
    class_group: "2-Cho",
  },
  {
    first_name: "Zoe",
    last_name: "Koen",
    aliases: ["Coen"],
    grade: "2",
    class_group: "2-Cho",
  },
  {
    first_name: "Ravi",
    last_name: "Nair",
    aliases: ["Nayar"],
    grade: "2",
    class_group: "2-Cho",
  },

  // --- Grade 3 ---
  {
    first_name: "Isabella",
    last_name: "Núñez",
    aliases: ["Nunez"],
    grade: "3",
    class_group: "3-Duval",
  },
  {
    first_name: "Caleb",
    last_name: "Nunes",
    aliases: ["Nunez"],
    grade: "3",
    class_group: "3-Duval",
  },
  {
    first_name: "Aisha",
    last_name: "Rahman",
    aliases: ["Rehman"],
    grade: "3",
    class_group: "3-Duval",
  },
  {
    first_name: "Ethan",
    last_name: "Chin",
    aliases: ["Chinn"],
    grade: "3",
    class_group: "3-Duval",
  },
  {
    first_name: "Mia",
    last_name: "van der Berg",
    aliases: ["Vanderberg", "Vandenberg", "Van Den Berg"],
    grade: "3",
    class_group: "3-Duval",
  },
  {
    first_name: "Noah",
    last_name: "Yu",
    aliases: ["Yoo", "You"],
    grade: "3",
    class_group: "3-Duval",
  },

  // --- Grade 4 ---
  {
    first_name: "Emma",
    last_name: "Smyth",
    aliases: ["Smith"],
    grade: "4",
    class_group: "4-Espinoza",
  },
  {
    first_name: "Julian",
    last_name: "D'Angelo",
    aliases: ["DAngelo", "Dangelo"],
    grade: "4",
    class_group: "4-Espinoza",
  },
  {
    first_name: "Layla",
    last_name: "Nguyen",
    aliases: ["Win", "Nuyen"],
    grade: "4",
    class_group: "4-Espinoza",
  },
  {
    first_name: "Minh",
    last_name: "Nguyen",
    aliases: ["Win", "Nuyen"],
    grade: "4",
    class_group: "4-Espinoza",
  },
  {
    first_name: "Ava",
    last_name: "Marsh",
    aliases: ["March"],
    grade: "4",
    class_group: "4-Espinoza",
  },
  {
    first_name: "Samuel",
    last_name: "Marchetti",
    aliases: ["Marketti"],
    grade: "4",
    class_group: "4-Espinoza",
  },

  // --- Grade 5 ---
  {
    first_name: "Charlotte",
    last_name: "Li",
    aliases: ["Lee", "Lie"],
    grade: "5",
    class_group: "5-Fitzgerald",
  },
  {
    first_name: "Benjamin",
    last_name: "Oh",
    aliases: ["Ho", "Ohh"],
    grade: "5",
    class_group: "5-Fitzgerald",
  },
  {
    first_name: "Harper",
    last_name: "Silva",
    aliases: ["Sylva"],
    grade: "5",
    class_group: "5-Fitzgerald",
  },
  {
    first_name: "Elena",
    last_name: "Silvia",
    aliases: ["Silvya"],
    grade: "5",
    class_group: "5-Fitzgerald",
  },
  {
    first_name: "Jackson",
    last_name: "Brooks",
    aliases: ["Brookes"],
    grade: "5",
    class_group: "5-Fitzgerald",
  },
  {
    first_name: "Amelia",
    last_name: "Brook",
    aliases: ["Brooke"],
    grade: "5",
    class_group: "5-Fitzgerald",
  },
];
