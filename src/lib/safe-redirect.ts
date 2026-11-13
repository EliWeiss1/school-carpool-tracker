/**
 * Validates a `?next=` value before the app redirects to it.
 *
 * An open redirect on a login page turns it into a phishing launchpad, so only
 * a same-origin relative path survives: it must start with a single `/`, and
 * contain no backslash (browsers treat `/\host` as `//host`) and no control
 * character (browsers strip tabs and newlines, so a tab-split `//host` would
 * slip through).
 */

const DEFAULT_NEXT = "/app";

// eslint-disable-next-line no-control-regex -- rejecting control characters is the point.
const CONTROL_OR_BACKSLASH = /[\u0000-\u001f\u007f\\]/;

export function safeNext(
  raw: string | readonly string[] | null | undefined,
  fallback: string = DEFAULT_NEXT,
): string {
  // A repeated query parameter arrives as an array; the first one wins.
  const value = typeof raw === "string" || raw == null ? raw : raw[0];
  if (typeof value !== "string" || value === "") return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (CONTROL_OR_BACKSLASH.test(value)) return fallback;

  // Belt and braces: whatever the string looks like, it must still resolve to
  // the origin it is resolved against.
  try {
    const base = "http://same-origin.invalid";
    if (new URL(value, base).origin !== base) return fallback;
  } catch {
    return fallback;
  }
  return value;
}
