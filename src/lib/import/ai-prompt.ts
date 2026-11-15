/**
 * The escape hatch for a spreadsheet the importer can't make sense of: a
 * prompt the admin copies into their own AI tool along with the file, which
 * hands back a CSV in exactly the shape the importer reads best.
 *
 * Nothing here calls an AI service. The school chooses whether to share its
 * roster with one, which is why the screen says so next to the button.
 */

/** The headings the importer reads with no guessing at all. */
export const IDEAL_HEADINGS = [
  "first_name",
  "last_name",
  "classes",
  "carpool",
  "parent1_name",
  "parent2_name",
  "nicknames",
] as const;

/** A starting template, for a school that would rather fill one in. */
export const SAMPLE_CSV = [
  IDEAL_HEADINGS.join(","),
  "Miriam,Cohen,2nd,Cohen family,Sarah Cohen,David Cohen,Miri",
  "Aaron,Cohen,K1,Cohen family,Sarah Cohen,David Cohen,",
  "Yosef,Levy,3rd; Choir,Levy and Katz,Rachel Levy,,Yossi",
  "Noa,Katz,3rd,Levy and Katz,Dina Katz,Avi Katz,",
].join("\r\n");

export const SAMPLE_FILE_NAME = "roster-template.csv";

/**
 * @param classNames the school's current classes, so the AI reuses their
 *   exact spelling instead of inventing "Grade 2" for "2nd".
 */
export function buildAiPrompt(classNames: readonly string[]): string {
  const classLine =
    classNames.length > 0
      ? `Our classes are named exactly: ${classNames.join(", ")}. Use these exact names whenever a student's class matches one. A class that isn't on this list is fine too; write it as it appears.`
      : "Use the class (or grade, homeroom or teacher) each student is in, written the same way every time.";

  return [
    "I'm attaching our school's student list. Please turn it into a CSV file for our carpool pickup system.",
    "",
    `Use exactly these column headings, in this order:\n${IDEAL_HEADINGS.join(",")}`,
    "",
    "Rules:",
    "- One row per student. If a row lists several children (for example one row per family), split it into one row per child.",
    '- Put the first name and last name in separate columns. If a name is written "Last, First", swap it.',
    `- classes: ${classLine} If a student is in more than one class, separate them with a semicolon, like: 2nd; Choir`,
    '- carpool: give children who are picked up together the same carpool name. Siblings usually ride together, so give them the same value, such as "Cohen family". If there is a separate carpool or ride list, use it to fill this column. Leave it blank if you don\'t know.',
    "- parent1_name and parent2_name: parents' or guardians' names, if the list has them.",
    "- nicknames: other names or spellings the child goes by, separated by semicolons. Usually blank.",
    "- Leave a cell blank rather than guessing. Don't invent students, classes or parents.",
    "- Leave out anything else (phone numbers, emails, addresses, notes).",
    "- Put every value that contains a comma in double quotes.",
    "",
    "Reply with only the CSV, in a single code block, so I can copy it.",
  ].join("\n");
}
