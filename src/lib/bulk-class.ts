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

/** The question the confirmation asks; Remove states the count, per the spec. */
export function bulkConfirmText(
  mode: BulkClassMode,
  count: number,
  className: string,
): string {
  return mode === "add"
    ? `Add ${students(count)} to ${className}?`
    : `Remove ${students(count)} from ${className}? They stay on the roster.`;
}

/**
 * The one-line result. `applied` is the selection minus any ids the server
 * ignored; `ignoredCount` those that were already deleted.
 */
export function bulkResultMessage(
  mode: BulkClassMode,
  applied: number,
  className: string,
  memberCount: number,
  ignoredCount: number,
): string {
  const done =
    mode === "add"
      ? `Added ${students(applied)} to ${className}.`
      : `Removed ${students(applied)} from ${className}.`;
  const tail =
    ignoredCount === 0
      ? ""
      : ` ${ignoredCount} ${ignoredCount === 1 ? "was" : "were"} already gone.`;
  return `${done} It now has ${memberCount}.${tail}`;
}
