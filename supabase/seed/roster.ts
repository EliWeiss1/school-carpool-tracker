/**
 * Sample roster for local development. Not real students.
 *
 * The surnames are chosen adversarially: every cluster below is a pair or trio
 * that a speech recogniser routinely confuses, so `npm run seed` gives the
 * matcher (phase 3) and the /display grid (phase 5) something genuinely hard to
 * work against rather than 105 unambiguous names.
 *
 * All first and last names are drawn from Jewish/Hebrew-derived traditions.
 * Classes are K1, K2, 1st, 2nd, 3rd, 4th, 5th. There are 105 students, each
 * with a primary class (15 per class), and six of them are deliberately in a
 * second class as well (the entries whose class_groups has two names), so the
 * multi-class paths -- one student under two sections of /display, reachable
 * from two class drawers -- have something to run against. Class memberships
 * therefore total 111, not 105.
 *
 * Clusters in here:
 *   Cohen / Kohen / Koen / Kohn / Cohn    — the canonical hard case, distributed
 *                                           across K1/K2/1st for first-name
 *                                           disambiguation testing
 *   Levi / Levy / Levine / Levin          — one-character and vowel variations
 *   Stein / Steen / Steinberg             — one-character edit and common suffix
 *   Klein / Kline                         — vowel swap (stein-tuned phonetics)
 *   Shapiro / Shapira                     — final vowel variation
 *   Rosen / Rosenberg / Rosenthal         — suffix variations and containment
 *   Gold / Goldman / Goldberg             — common surname prefix + suffix
 *   Weiss / Wise / Weiser                 — vowel drop and -er suffix
 *   Berg / Berger / Bergman               — suffix containment and variations
 *   Adler / Alder                         — vowel swap
 *   Fisher / Fischer                      — -er vs -er with C
 *   Feld / Feldman                        — singular vs. -man suffix
 *   Green / Greenberg                     — suffix containment
 *   Silver / Silverman                    — suffix addition
 *   Miller / Mueller                      — Anglicized vs. Yiddish spelling
 *   Perlman / Pearlman                    — consonant drop and -man suffix
 *   Wexler / Wexner                       — -ler vs -ner ending
 *   Cohn                                   — a fifth Cohen-family spelling,
 *                                            standalone (not just an alias)
 *   Oz / Tal / Bar                        — short Hebrew surnames (2-3
 *                                            letters), where a single edit is
 *                                            a huge share of the string
 */

export interface SampleStudent {
  first_name: string;
  last_name: string;
  aliases: string[];
  /** One or more class names; a student can belong to several. */
  class_groups: string[];
}

export const SAMPLE_ROSTER: SampleStudent[] = [
  // --- K1 ---
  {
    first_name: "Maya",
    last_name: "Cohen",
    aliases: ["Kohen", "Cohn"],
    class_groups: ["K1"],
  },
  {
    first_name: "Ari",
    last_name: "Kohen",
    aliases: ["Cohen", "Kohn"],
    class_groups: ["K1", "K2"],
  },
  {
    first_name: "Noa",
    last_name: "Koen",
    aliases: ["Cohen", "Coen"],
    class_groups: ["K1"],
  },
  {
    first_name: "Eitan",
    last_name: "Levi",
    aliases: ["Levy", "Levee"],
    class_groups: ["K1"],
  },
  {
    first_name: "Shira",
    last_name: "Levy",
    aliases: ["Levi"],
    class_groups: ["K1"],
  },
  {
    first_name: "Mira",
    last_name: "Stein",
    aliases: ["Steen", "Styne"],
    class_groups: ["K1"],
  },
  {
    first_name: "Asher",
    last_name: "Steen",
    aliases: ["Stein"],
    class_groups: ["K1"],
  },
  {
    first_name: "Talia",
    last_name: "Klein",
    aliases: ["Kline", "Cline"],
    class_groups: ["K1"],
  },
  {
    first_name: "Ezra",
    last_name: "Shapiro",
    aliases: ["Shapira", "Shapero"],
    class_groups: ["K1"],
  },
  {
    first_name: "Liora",
    last_name: "Rosen",
    aliases: ["Rosin", "Rozen"],
    class_groups: ["K1"],
  },
  {
    first_name: "Dov",
    last_name: "Rosenberg",
    aliases: ["Rosenburg", "Rozenberg"],
    class_groups: ["K1"],
  },
  {
    first_name: "Yael",
    last_name: "Gold",
    aliases: ["Gould"],
    class_groups: ["K1"],
  },
  {
    first_name: "Gabriel",
    last_name: "Goldman",
    aliases: ["Goldmann"],
    class_groups: ["K1"],
  },
  {
    first_name: "Naomi",
    last_name: "Weiss",
    aliases: ["Wise", "Weize"],
    class_groups: ["K1"],
  },
  {
    first_name: "Judah",
    last_name: "Berg",
    aliases: ["Burg", "Bergh"],
    class_groups: ["K1"],
  },

  // --- K2 ---
  {
    first_name: "Rivka",
    last_name: "Cohen",
    aliases: ["Kohen", "Kohn"],
    class_groups: ["K2"],
  },
  {
    first_name: "Jonah",
    last_name: "Kohn",
    aliases: ["Cohen", "Cohn"],
    class_groups: ["K2"],
  },
  {
    first_name: "Leah",
    last_name: "Levine",
    aliases: ["Levin", "Leveen"],
    class_groups: ["K2", "1st"],
  },
  {
    first_name: "Shmuel",
    last_name: "Steinberg",
    aliases: ["Steinburg", "Stainberg"],
    class_groups: ["K2"],
  },
  {
    first_name: "Chana",
    last_name: "Kline",
    aliases: ["Klein", "Cline"],
    class_groups: ["K2"],
  },
  {
    first_name: "Yosef",
    last_name: "Shapira",
    aliases: ["Shapiro", "Shapera"],
    class_groups: ["K2"],
  },
  {
    first_name: "Miriam",
    last_name: "Rosenthal",
    aliases: ["Rosental", "Rosenthall"],
    class_groups: ["K2"],
  },
  {
    first_name: "Raphael",
    last_name: "Goldberg",
    aliases: ["Gould-burg"],
    class_groups: ["K2"],
  },
  {
    first_name: "Devorah",
    last_name: "Wise",
    aliases: ["Weiss", "Wyse"],
    class_groups: ["K2"],
  },
  {
    first_name: "Moshe",
    last_name: "Weiser",
    aliases: ["Weisser", "Wiser"],
    class_groups: ["K2"],
  },
  {
    first_name: "Sarah",
    last_name: "Berger",
    aliases: ["Burger", "Berg"],
    class_groups: ["K2"],
  },
  {
    first_name: "Avraham",
    last_name: "Adler",
    aliases: ["Alder", "Addler"],
    class_groups: ["K2"],
  },
  {
    first_name: "Esther",
    last_name: "Fisher",
    aliases: ["Fischer", "Fishcher"],
    class_groups: ["K2"],
  },
  {
    first_name: "Yaakov",
    last_name: "Feld",
    aliases: ["Veld", "Felde"],
    class_groups: ["K2"],
  },
  {
    first_name: "Rachel",
    last_name: "Green",
    aliases: ["Greenberg", "Greene"],
    class_groups: ["K2"],
  },

  // --- 1st ---
  {
    first_name: "Zoe",
    last_name: "Koen",
    aliases: ["Cohen", "Kone"],
    class_groups: ["1st"],
  },
  {
    first_name: "Ethan",
    last_name: "Levine",
    aliases: ["Levin", "Leveene"],
    class_groups: ["1st"],
  },
  {
    first_name: "Hannah",
    last_name: "Steen",
    aliases: ["Stein", "Stene"],
    class_groups: ["1st"],
  },
  {
    first_name: "Eli",
    last_name: "Steinberg",
    aliases: ["Stainberg", "Stein-burg"],
    class_groups: ["1st"],
  },
  {
    first_name: "Bracha",
    last_name: "Klein",
    aliases: ["Kline", "Clein"],
    class_groups: ["1st"],
  },
  {
    first_name: "Levi",
    last_name: "Levy",
    aliases: ["Levi", "Levee"],
    class_groups: ["1st"],
  },
  {
    first_name: "Ilana",
    last_name: "Shapiro",
    aliases: ["Shapira", "Shapirow"],
    class_groups: ["1st"],
  },
  {
    first_name: "Menachem",
    last_name: "Rosen",
    aliases: ["Rosin", "Rozen"],
    class_groups: ["1st"],
  },
  {
    first_name: "Nora",
    last_name: "Goldberg",
    aliases: ["Goldburg", "Gould-berg"],
    class_groups: ["1st"],
  },
  {
    first_name: "Gabe",
    last_name: "Weiss",
    aliases: ["Wise", "Weis"],
    class_groups: ["1st"],
  },
  {
    first_name: "Ruth",
    last_name: "Bergman",
    aliases: ["Bergmann", "Bergemen"],
    class_groups: ["1st"],
  },
  {
    first_name: "David",
    last_name: "Alder",
    aliases: ["Adler", "Aldere"],
    class_groups: ["1st"],
  },
  {
    first_name: "Rebekah",
    last_name: "Tal",
    aliases: ["Thal"],
    class_groups: ["1st", "3rd"],
  },
  {
    first_name: "Jacob",
    last_name: "Feldman",
    aliases: ["Feldmann", "Feldmen"],
    class_groups: ["1st"],
  },
  {
    first_name: "Judith",
    last_name: "Greenberg",
    aliases: ["Greenbert", "Greenburg"],
    class_groups: ["1st"],
  },

  // --- 2nd ---
  {
    first_name: "Shalom",
    last_name: "Silver",
    aliases: ["Silverman", "Silber"],
    class_groups: ["2nd"],
  },
  {
    first_name: "Batsheva",
    last_name: "Miller",
    aliases: ["Mueller", "Muller"],
    class_groups: ["2nd"],
  },
  {
    first_name: "Yitzchak",
    last_name: "Perlman",
    aliases: ["Pearlman", "Perlmann"],
    class_groups: ["2nd"],
  },
  {
    first_name: "Shulamit",
    last_name: "Wexler",
    aliases: ["Wexner", "Wexlar"],
    class_groups: ["2nd"],
  },
  {
    first_name: "Aaron",
    last_name: "Cohen",
    aliases: ["Kohen", "Kohn"],
    class_groups: ["2nd", "3rd"],
  },
  {
    first_name: "Dinah",
    last_name: "Levi",
    aliases: ["Levy", "Levee"],
    class_groups: ["2nd"],
  },
  {
    first_name: "Naftali",
    last_name: "Stein",
    aliases: ["Steen", "Stine"],
    class_groups: ["2nd"],
  },
  {
    first_name: "Ahuva",
    last_name: "Klein",
    aliases: ["Kline", "Klien"],
    class_groups: ["2nd"],
  },
  {
    first_name: "Yochanan",
    last_name: "Shapira",
    aliases: ["Shapiro", "Shapirah"],
    class_groups: ["2nd"],
  },
  {
    first_name: "Batya",
    last_name: "Rosenberg",
    aliases: ["Rosenburg", "Rozenberg"],
    class_groups: ["2nd"],
  },
  {
    first_name: "Nissim",
    last_name: "Goldstein",
    aliases: ["Goldstien", "Gould-stine"],
    class_groups: ["2nd"],
  },
  {
    first_name: "Haya",
    last_name: "Weiser",
    aliases: ["Weisser", "Wizer"],
    class_groups: ["2nd"],
  },
  {
    first_name: "Yisrael",
    last_name: "Berger",
    aliases: ["Burger", "Bergh"],
    class_groups: ["2nd"],
  },
  {
    first_name: "Tziporah",
    last_name: "Adler",
    aliases: ["Alder", "Addler"],
    class_groups: ["2nd"],
  },
  {
    first_name: "Menachem",
    last_name: "Fisher",
    aliases: ["Fischer", "Fishhcher"],
    class_groups: ["2nd"],
  },

  // --- 3rd ---
  {
    first_name: "Chana",
    last_name: "Feld",
    aliases: ["Veld", "Fehld"],
    class_groups: ["3rd"],
  },
  {
    first_name: "Simcha",
    last_name: "Green",
    aliases: ["Greenberg", "Grean"],
    class_groups: ["3rd"],
  },
  {
    first_name: "Chaya",
    last_name: "Silverman",
    aliases: ["Silvermann", "Silverma"],
    class_groups: ["3rd"],
  },
  {
    first_name: "Shmuel",
    last_name: "Mueller",
    aliases: ["Miller", "Muller"],
    class_groups: ["3rd"],
  },
  {
    first_name: "Esther",
    last_name: "Pearlman",
    aliases: ["Perlman", "Pearleman"],
    class_groups: ["3rd"],
  },
  {
    first_name: "Yitzhak",
    last_name: "Wexner",
    aliases: ["Wexler", "Wexnor"],
    class_groups: ["3rd"],
  },
  {
    first_name: "Miriam",
    last_name: "Cohen",
    aliases: ["Kohen", "Cohn"],
    class_groups: ["3rd"],
  },
  {
    first_name: "Avram",
    last_name: "Levy",
    aliases: ["Levi", "Levee"],
    class_groups: ["3rd"],
  },
  {
    first_name: "Bryna",
    last_name: "Steinberg",
    aliases: ["Stainberg", "Stein-burg"],
    class_groups: ["3rd"],
  },
  {
    first_name: "Hirsh",
    last_name: "Kline",
    aliases: ["Klein", "Cline"],
    class_groups: ["3rd"],
  },
  {
    first_name: "Leeba",
    last_name: "Shapiro",
    aliases: ["Shapira", "Shapirow"],
    class_groups: ["3rd"],
  },
  {
    first_name: "Mottel",
    last_name: "Rosenthal",
    aliases: ["Rosental", "Rosenthall"],
    class_groups: ["3rd"],
  },
  {
    first_name: "Ruchel",
    last_name: "Goldberg",
    aliases: ["Gould-burg", "Galdberg"],
    class_groups: ["3rd"],
  },
  {
    first_name: "Baruch",
    last_name: "Wise",
    aliases: ["Weiss", "Wyse"],
    class_groups: ["3rd"],
  },
  {
    first_name: "Yehudit",
    last_name: "Bergman",
    aliases: ["Bergmann", "Bergemen"],
    class_groups: ["3rd"],
  },

  // --- 4th ---
  {
    first_name: "Yochanan",
    last_name: "Alder",
    aliases: ["Adler", "Addler"],
    class_groups: ["4th"],
  },
  {
    first_name: "Devorah",
    last_name: "Fischer",
    aliases: ["Fisher", "Fisscher"],
    class_groups: ["4th"],
  },
  {
    first_name: "Noach",
    last_name: "Oz",
    aliases: ["Otz"],
    class_groups: ["4th"],
  },
  {
    first_name: "Chaviva",
    last_name: "Bar",
    aliases: ["Barr"],
    class_groups: ["4th"],
  },
  {
    first_name: "Hirsch",
    last_name: "Silver",
    aliases: ["Silverman", "Silber"],
    class_groups: ["4th"],
  },
  {
    first_name: "Feige",
    last_name: "Miller",
    aliases: ["Mueller", "Muller"],
    class_groups: ["4th"],
  },
  {
    first_name: "Zvi",
    last_name: "Perlman",
    aliases: ["Pearlman", "Perlmann"],
    class_groups: ["4th"],
  },
  {
    first_name: "Tova",
    last_name: "Wexler",
    aliases: ["Wexner", "Wexlar"],
    class_groups: ["4th"],
  },
  {
    first_name: "Ruvim",
    last_name: "Koen",
    aliases: ["Cohen", "Coen"],
    class_groups: ["4th", "5th"],
  },
  {
    first_name: "Malka",
    last_name: "Levine",
    aliases: ["Levin", "Leveen"],
    class_groups: ["4th"],
  },
  {
    first_name: "Shlomo",
    last_name: "Steen",
    aliases: ["Stein", "Stene"],
    class_groups: ["4th"],
  },
  {
    first_name: "Chaya",
    last_name: "Klein",
    aliases: ["Kline", "Clein"],
    class_groups: ["4th"],
  },
  {
    first_name: "Eliyahu",
    last_name: "Shapira",
    aliases: ["Shapiro", "Shapirah"],
    class_groups: ["4th"],
  },
  {
    first_name: "Yehudit",
    last_name: "Rosen",
    aliases: ["Rosin", "Rozen"],
    class_groups: ["4th"],
  },
  {
    first_name: "Ephraim",
    last_name: "Goldstein",
    aliases: ["Goldstien", "Gould-stine"],
    class_groups: ["4th"],
  },

  // --- 5th ---
  {
    first_name: "Raizel",
    last_name: "Weiss",
    aliases: ["Wise", "Weis"],
    class_groups: ["5th"],
  },
  {
    first_name: "Meir",
    last_name: "Weiser",
    aliases: ["Weisser", "Wizer"],
    class_groups: ["5th"],
  },
  {
    first_name: "Basya",
    last_name: "Berger",
    aliases: ["Burger", "Bergh"],
    class_groups: ["5th"],
  },
  {
    first_name: "Shimon",
    last_name: "Adler",
    aliases: ["Alder", "Addler"],
    class_groups: ["5th"],
  },
  {
    first_name: "Chaya",
    last_name: "Fisher",
    aliases: ["Fischer", "Fishhcher"],
    class_groups: ["5th"],
  },
  {
    first_name: "Yisrael",
    last_name: "Feld",
    aliases: ["Veld", "Fehld"],
    class_groups: ["5th"],
  },
  {
    first_name: "Gittel",
    last_name: "Green",
    aliases: ["Greenberg", "Grean"],
    class_groups: ["5th", "4th"],
  },
  {
    first_name: "Mendy",
    last_name: "Silverman",
    aliases: ["Silvermann", "Silverma"],
    class_groups: ["5th"],
  },
  {
    first_name: "Ruchel",
    last_name: "Mueller",
    aliases: ["Miller", "Muller"],
    class_groups: ["5th"],
  },
  {
    first_name: "Baruch",
    last_name: "Pearlman",
    aliases: ["Perlman", "Pearleman"],
    class_groups: ["5th"],
  },
  {
    first_name: "Yael",
    last_name: "Wexner",
    aliases: ["Wexler", "Wexnor"],
    class_groups: ["5th"],
  },
  {
    first_name: "Chana",
    last_name: "Cohn",
    aliases: ["Cohen", "Kohen"],
    class_groups: ["5th"],
  },
  {
    first_name: "Avraham",
    last_name: "Levin",
    aliases: ["Levy", "Levee"],
    class_groups: ["5th"],
  },
  {
    first_name: "Dvora",
    last_name: "Steinberg",
    aliases: ["Stainberg", "Stein-burg"],
    class_groups: ["5th"],
  },
  {
    first_name: "Yosef",
    last_name: "Kline",
    aliases: ["Klein", "Clien"],
    class_groups: ["5th"],
  },
];
