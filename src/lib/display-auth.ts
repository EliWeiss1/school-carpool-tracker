/**
 * Server-side rules for the /display password. Kept free of Next.js imports so
 * they are unit-testable in Node.
 *
 * This is a different secret from the staff PIN on purpose: the PIN authorises
 * writes, this only authorises looking at the board, and the two are handed to
 * different people. It is checked in a Next.js route handler and remembered in
 * an httpOnly cookie -- unlike the PIN, which CLAUDE.md keeps out of every kind
 * of storage -- because a wall-mounted board must survive a reload or a power
 * cut without anybody standing there to retype it.
 */

export const DISPLAY_COOKIE = "display-access";

/** One year: the board is meant to stay signed in until the password changes. */
export const DISPLAY_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** The server's configured password, or null when unset (which fails closed). */
export function configuredDisplayPassword(): string | null {
  const value = (process.env.DISPLAY_PASSWORD ?? "").trim();
  return value === "" ? null : value;
}

/**
 * What the cookie holds: a hash of the password, never the password itself.
 * Because it is derived from the current password, changing DISPLAY_PASSWORD
 * signs every board out at once.
 */
export async function accessToken(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(`display-access:v1:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/** Compares without bailing at the first differing character. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function passwordIsCorrect(
  attempt: string,
  password: string,
): Promise<boolean> {
  return safeEqual(await accessToken(attempt), await accessToken(password));
}

/** True when the cookie value proves the visitor entered the current password. */
export async function cookieIsValid(
  cookieValue: string | undefined,
  password: string | null,
): Promise<boolean> {
  if (!cookieValue || password === null) return false;
  return safeEqual(cookieValue, await accessToken(password));
}
