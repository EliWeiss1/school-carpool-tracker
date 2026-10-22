import { ApiError } from "@/lib/api";
import {
  classDeleteDecision,
  type ClassDeleteNeedsDecision,
} from "@/lib/admin-api";
import type { ClassGroup } from "@/lib/class-groups";

/**
 * Pure decisions behind the safe class delete (spec: "Retiring a class").
 * The component only wires these to state and to `adminApi.deleteClass`.
 */

/** How many sole-member names the dialog lists before "and N more". */
export const PREVIEW_NAME_LIMIT = 5;

export type DeleteFailure =
  /** 409: some students are only in this class -- ask the admin what to do. */
  | { kind: "decide"; decision: ClassDeleteNeedsDecision }
  /** 404: the class is already gone -- refresh the list and say so. */
  | { kind: "gone"; message: string }
  | { kind: "failed"; message: string };

export function classifyDeleteFailure(error: unknown): DeleteFailure {
  const decision = classDeleteDecision(error);
  if (decision !== null) return { kind: "decide", decision };
  if (error instanceof ApiError) {
    return error.status === 404
      ? { kind: "gone", message: error.message }
      : { kind: "failed", message: error.message };
  }
  return { kind: "failed", message: "Could not remove that class. Try again." };
}

/**
 * "Move" stays disabled until a destination is picked, and only while that
 * destination is still on offer (it may have been deleted elsewhere since).
 */
export function canMove(
  moveToClassId: string | null,
  targets: readonly ClassGroup[],
): boolean {
  return (
    moveToClassId !== null &&
    moveToClassId !== "" &&
    targets.some((t) => t.id === moveToClassId)
  );
}

export type DeleteChoice =
  | { action: "move"; moveToClassId: string }
  | { action: "force" };

/** The extra field the repeat `deleteClass` call carries. */
export function deleteResolution(
  choice: DeleteChoice,
): { moveToClassId: string } | { force: true } {
  return choice.action === "move"
    ? { moveToClassId: choice.moveToClassId }
    : { force: true };
}

function students(count: number): string {
  return `${count} student${count === 1 ? "" : "s"}`;
}

/** M is the class's WHOLE membership: move relocates everyone, not just sole members. */
export function moveButtonLabel(memberCount: number, targetName: string): string {
  return `Move ${students(memberCount)} to ${targetName} and delete`;
}

export function deleteDecisionHeading(soleMemberCount: number): string {
  return soleMemberCount === 1
    ? "1 student is only in this class"
    : `${soleMemberCount} students are only in this class`;
}

export function previewNames(
  soleMembers: ClassDeleteNeedsDecision["soleMembers"],
  soleMemberCount: number,
): { names: string[]; more: number } {
  const shown = soleMembers.slice(0, PREVIEW_NAME_LIMIT);
  return {
    names: shown.map((m) => `${m.first_name} ${m.last_name}`),
    more: Math.max(0, soleMemberCount - shown.length),
  };
}

/** The destinations offered: every class but the one being deleted. */
export function otherClasses(
  classGroups: readonly ClassGroup[],
  deletingId: string,
): ClassGroup[] {
  return classGroups.filter((g) => g.id !== deletingId);
}
