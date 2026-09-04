/**
 * The fixed set of classes, in display order. K1/K2 are kindergarten
 * sections; the rest are grade-equivalent class names. Used to back every
 * class picker (admin roster form, /announce's narrow-by-class control) so
 * staff choose from a known list rather than retyping free text.
 *
 * `students.class_group` itself stays a free-text column (CSV import and the
 * Edge Functions accept any string) — this list is a UI convenience, not a
 * database constraint, so a future class doesn't require a migration.
 */
export const CLASS_GROUPS = [
  "K1",
  "K2",
  "1st",
  "2nd",
  "3rd",
  "4th",
  "5th",
] as const;
