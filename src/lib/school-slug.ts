/**
 * A school's web address (`/s/<slug>`): suggesting one from its name and
 * checking one a person typed.
 *
 * The rule mirrors the `schools.slug` check constraint in the database exactly,
 * so a value this accepts is never bounced by Postgres. Pure, so it is
 * unit-tested without a DOM.
 */

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 48;

/** Same expression as the database: 3 to 48 chars, no hyphen at either end. */
export const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{1,46}[a-z0-9])$/;

/**
 * Turns a school name into a web address: "St. Mary's School" becomes
 * "st-marys-school". Apostrophes are dropped rather than turned into hyphens so
 * a possessive stays one word. Returns an empty string when nothing usable is
 * left; the caller then shows no suggestion.
 */
export function suggestSlug(name: string): string {
  const folded = name
    .normalize("NFKD")
    // Combining accents left behind by NFKD, so an n-tilde becomes a plain n.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "");

  const hyphenated = folded.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  // Cutting can land just after a hyphen, so trim again.
  return hyphenated.slice(0, SLUG_MAX_LENGTH).replace(/-+$/g, "");
}

/** One plain sentence saying what to change, or null when the slug is valid. */
export function validateSlug(slug: string): string | null {
  if (slug === "") return "Enter a web address.";
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return "Use lowercase letters, numbers and hyphens only.";
  }
  if (slug.length < SLUG_MIN_LENGTH) {
    return `Use at least ${SLUG_MIN_LENGTH} characters.`;
  }
  if (slug.length > SLUG_MAX_LENGTH) {
    return `Use ${SLUG_MAX_LENGTH} characters or fewer.`;
  }
  if (!SLUG_PATTERN.test(slug)) {
    return "Start and end the web address with a letter or number.";
  }
  return null;
}
