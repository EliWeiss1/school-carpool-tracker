import type { ClassMembersInput } from "@/lib/admin-api";

/**
 * Pure helpers for the roster's "Add to class..." / "Remove from class..."
 * bulk actions. Both go through the one `members` endpoint; neither touches
 * a student's status.
 */

export type BulkClassMode = "add" | "remove";

function students(count: number): string {
  return `${count} student${count === 1 ? "" : "s"}`;
}

/** The `changeClassMembers` body: additions for Add, removals for Remove. */
export function bulkMembershipInput(
  mode: BulkClassMode,
  classId: string,
  selectedIds: ReadonlySet<string>,
): Pick<ClassMembersInput, "classId" | "addStudentIds" | "removeStudentIds"> {
  const ids = [...selectedIds];
  return mode === "add"
    ? { classId, addStudentIds: ids }
    : { classId, removeStudentIds: ids };
}

/**
 * The question the confirmation asks; Remove states the count, per the spec.
 * `stranded` is how many of them would be left with no class (Remove only).
 */
export function bulkConfirmText(
  mode: BulkClassMode,
  count: number,
  className: string,
  stranded = 0,
): string {
  if (mode === "add") return `Add ${students(count)} to ${className}?`;
  const base = `Remove ${students(count)} from ${className}? They stay on the roster.`;
  if (stranded <= 0) return base;
  const warning =
    count === 1
      ? "That student will have no class after this."
      : `${stranded} of them will have no class after this.`;
  return `${base} ${warning}`;
}

/**
 * The one-line result. `applied` is the selection minus any ids the server
 * ignored; `ignoredCount` those that were already deleted.
 *
 * It states the end state ("are now in"), not a count of changes: `applied`
 * includes students who were already members (or already not), and the
 * server does not say how many actually moved.
 */
export function bulkResultMessage(
  mode: BulkClassMode,
  applied: number,
  className: string,
  memberCount: number,
  ignoredCount: number,
): string {
  const verb = applied === 1 ? "is" : "are";
  const done =
    mode === "add"
      ? `${students(applied)} ${verb} now in ${className}.`
      : `${students(applied)} ${verb} no longer in ${className}.`;
  const tail =
    ignoredCount === 0
      ? ""
      : ` ${ignoredCount} ${ignoredCount === 1 ? "was" : "were"} already gone.`;
  return `${done} It now has ${memberCount}.${tail}`;
}
