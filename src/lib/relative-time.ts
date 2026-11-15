/** Plain "3 hours ago" wording. The clock is injected so tests are exact. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}

export function relativeTime(iso: string, now: Date): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "Unknown";
  const elapsed = Math.max(0, now.getTime() - then);
  if (elapsed < MINUTE) return "Just now";
  if (elapsed < HOUR) return plural(Math.floor(elapsed / MINUTE), "minute");
  if (elapsed < DAY) return plural(Math.floor(elapsed / HOUR), "hour");
  return plural(Math.floor(elapsed / DAY), "day");
}

/** A device that has never reported in has no last-seen time. */
export function lastSeenLabel(iso: string | null, now: Date): string {
  return iso === null ? "Not seen yet" : relativeTime(iso, now);
}
