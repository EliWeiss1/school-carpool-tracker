/**
 * Join class names, dropping falsey ones.
 *
 * Deliberately not `clsx` or `tailwind-merge`: this app has one small design
 * system and no runtime class merging to do, and a dependency in the client
 * bundle should have to earn its place.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
