/**
 * Validation for what a school's office types: its name, web address, time
 * zone, nightly reset, and a device's label. Each reader returns the cleaned
 * value or one sentence a staff member can act on, so handlers pass the
 * sentence straight through.
 */

export type Read<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): Read<T> => ({ ok: true, value });
const fail = (error: string): Read<never> => ({ ok: false, error });

export const MAX_SCHOOL_NAME_LENGTH = 120;
export const MAX_DEVICE_LABEL_LENGTH = 60;

/** The pattern the schools table enforces, so the database never refuses what passed here. */
const SLUG = /^[a-z0-9]([a-z0-9-]{1,46}[a-z0-9])$/;

export function readSchoolName(input: unknown): Read<string> {
  const name = typeof input === "string" ? input.trim() : "";
  if (name === "") return fail("Enter the school name.");
  if (name.length > MAX_SCHOOL_NAME_LENGTH) {
    return fail(
      `That school name is too long (limit ${MAX_SCHOOL_NAME_LENGTH} characters).`,
    );
  }
  return ok(name);
}

export function readSlug(input: unknown): Read<string> {
  if (typeof input !== "string" || !SLUG.test(input)) {
    return fail(
      "Use 3 to 48 lowercase letters, numbers and dashes for the web address, starting and ending with a letter or number.",
    );
  }
  return ok(input);
}

export function readTimeZone(input: unknown): Read<string> {
  const message = "That time zone was not recognised. Pick one from the list.";
  if (typeof input !== "string" || input.trim() === "") return fail(message);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: input.trim() });
    return ok(input.trim());
  } catch {
    return fail(message);
  }
}

export function readResetHour(input: unknown): Read<number> {
  if (
    typeof input !== "number" ||
    !Number.isInteger(input) ||
    input < 0 ||
    input > 23
  ) {
    return fail("The reset hour must be a whole number from 0 to 23.");
  }
  return ok(input);
}

export function readResetDays(input: unknown): Read<number[]> {
  const message =
    "Pick reset days from Sunday (0) to Saturday (6), each at most once.";
  if (!Array.isArray(input)) return fail(message);
  const seen = new Set<number>();
  for (const day of input) {
    if (
      typeof day !== "number" ||
      !Number.isInteger(day) ||
      day < 0 ||
      day > 6 ||
      seen.has(day)
    ) {
      return fail(message);
    }
    seen.add(day);
  }
  return ok([...seen]);
}

/** Optional: absent or blank is no label. */
export function readDeviceLabel(input: unknown): Read<string | null> {
  if (input === undefined || input === null) return ok(null);
  if (typeof input !== "string") return fail("That device name is not valid.");
  const label = input.trim();
  if (label === "") return ok(null);
  if (label.length > MAX_DEVICE_LABEL_LENGTH) {
    return fail(
      `That device name is too long (limit ${MAX_DEVICE_LABEL_LENGTH} characters).`,
    );
  }
  return ok(label);
}
