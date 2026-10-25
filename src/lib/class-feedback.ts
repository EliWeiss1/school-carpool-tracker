import type { MembershipDiff } from "@/lib/class-members";

/**
 * The one quiet status line the Classes panel shows after an action, so a
 * successful Save / Add / Remove is never a silent no-op. Copy lives here, not
 * in the component, so the wording is unit-tested and stays consistent with
 * the roster's bulk-action messages ("states the end state").
 */

function students(count: number): string {
  return `${count} student${count === 1 ? "" : "s"}`;
}

/** The class's size after a Save: today's count, plus adds, minus removes. */
export function memberCountAfter(
  current: number,
  diff: MembershipDiff,
): number {
  return Math.max(0, current + diff.add.length - diff.remove.length);
}

export function savedMessage(className: string, memberCount: number): string {
  return `Saved. ${className} now has ${students(memberCount)}.`;
}

export function addedMessage(className: string): string {
  return `Added ${className} at the bottom of the list.`;
}

/** `moved` is set when the admin chose to move the members somewhere first. */
export function removedMessage(
  className: string,
  moved?: { count: number; targetName: string },
): string {
  const base = `Removed ${className}.`;
  if (moved === undefined || moved.count <= 0) return base;
  return `${base} ${students(moved.count)} moved to ${moved.targetName}.`;
}
