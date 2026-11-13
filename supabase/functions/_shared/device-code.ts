/**
 * The short codes an office gives its phones and boards.
 *
 * A code is typed by a person on a phone, so it is forgiving about case, spaces
 * and dashes ("abc-123" is "ABC123"). Comparison reuses the staff PIN's approach
 * (hash both sides to 32 bytes, XOR every byte) so a wrong first character
 * takes as long to reject as a wrong last one.
 */

const encoder = new TextEncoder();

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

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  );
}

/**
 * True when `candidate` is the stored code. An unset (null or empty) stored code
 * never matches, so a school that has not set a code cannot be paired with an
 * empty guess. The hashes are computed either way, so "no code set" costs the
 * same time as "wrong code".
 */
export async function deviceCodeMatches(
  candidate: string,
  stored: string | null | undefined,
): Promise<boolean> {
  const normalizedCandidate = normalizeDeviceCode(candidate);
  const normalizedStored = normalizeDeviceCode(stored ?? "");
  const [a, b] = await Promise.all([
    digest(normalizedCandidate),
    digest(normalizedStored),
  ]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return (
    difference === 0 && normalizedStored !== "" && normalizedCandidate !== ""
  );
}
