/**
 * Field parsing shared by the roster-writing handlers.
 *
 * Kept separate from `http.ts`'s generic `readString` because `aliases` is the
 * one field on a student that is an array, not a scalar -- every other roster
 * field reads through `readString` directly.
 */

/**
 * `aliases` arrives as a JSON array of strings (the admin UI has already split
 * whatever delimiter the person typed or the CSV used). Anything that is not a
 * non-empty string is dropped rather than rejected: a stray blank entry from a
 * trailing comma is not worth failing the whole write over.
 */
export function readAliases(body: Record<string, unknown>): string[] {
  const raw = body.aliases;
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (trimmed === "" || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    out.push(trimmed);
  }
  return out;
}
