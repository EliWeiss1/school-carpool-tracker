/**
 * The short codes an office gives its phones and boards.
 *
 * A code is typed by a person on a phone, so it is forgiving about case, spaces
 * and dashes ("abc-123" is "ABC123"). The comparison itself happens in the database
 * (attempt_pairing), under the school's row lock.
 */

export const MIN_CODE_LENGTH = 6;
export const MAX_CODE_LENGTH = 20;

export function normalizeDeviceCode(input: string): string {
  return input.trim().toUpperCase().replace(/[\s-]/g, "");
}

export function isValidDeviceCode(input: unknown): boolean {
  if (typeof input !== "string") return false;
  const code = normalizeDeviceCode(input);
  return (
    code.length >= MIN_CODE_LENGTH &&
    code.length <= MAX_CODE_LENGTH &&
    /^[A-Z0-9]+$/.test(code)
  );
}
