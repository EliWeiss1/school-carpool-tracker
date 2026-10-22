"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import type { ClassDeleteNeedsDecision } from "@/lib/admin-api";
import type { ClassGroup } from "@/lib/class-groups";
import {
  type DeleteChoice,
  canMove,
  deleteDecisionHeading,
  moveButtonLabel,
  previewNames,
} from "@/lib/class-delete";

import { ModalSurface } from "./modal-surface";

export interface ClassDeleteDialogProps {
  /** The class being deleted. */
  classGroup: ClassGroup;
  decision: ClassDeleteNeedsDecision;
  /** Destinations: every class but the one being deleted. */
  targets: readonly ClassGroup[];
  busy: boolean;
  error: string | null;
  /** Re-sends the delete with `moveToClassId` or `force`. */
  onResolve: (choice: DeleteChoice) => void;
  onCancel: () => void;
}


const SELECT_CLASS =
  "focus-ring min-h-tap w-full rounded-xl border border-curb-300 bg-curb-50 px-3.5 text-curb-900 transition-colors duration-150 hover:border-curb-400";

/**
 * Shown when deleting a class would leave some students with no class at all.
 * The admin decides: move everyone in the class to another one, delete anyway
 * (those students end up with no class, and the dialog says so), or cancel.
 * Which call is re-sent, and when "Move" is enabled, are pure rules in
 * `lib/class-delete.ts`.
 */
export function ClassDeleteDialog({
  classGroup,
  decision,
  targets,
  busy,
  error,
  onResolve,
  onCancel,
}: ClassDeleteDialogProps) {
  const titleId = useId();
  const pickerId = useId();
  const [targetId, setTargetId] = useState("");
  const target = targets.find((t) => t.id === targetId);
  const preview = previewNames(decision.soleMembers, decision.soleMemberCount);

  return (
    <ModalSurface
      labelledBy={titleId}
      onClose={onCancel}
      dismissible={!busy}
      className="sm:max-w-lg"
    >
      <div className="flex-1 overflow-y-auto px-6 pb-4 pt-6">
        <p className="font-mono text-xs uppercase tracking-eyebrow text-curb-500">
          Remove {classGroup.name}
        </p>
        <h2
          id={titleId}
          className="mt-1 font-display text-2xl font-bold text-curb-900"
        >
          {deleteDecisionHeading(decision.soleMemberCount)}
        </h2>
        <p className="mt-2 text-curb-600">
          Removing {classGroup.name} would leave{" "}
          {decision.soleMemberCount === 1 ? "this student" : "these students"}{" "}
          in no class:
        </p>
        <ul className="mt-3 flex flex-col gap-1 rounded-xl border border-curb-200 bg-curb-50 px-4 py-3 text-curb-900">
          {preview.names.map((name, index) => (
            <li key={`${index}-${name}`}>{name}</li>
          ))}
          {preview.more > 0 && (
            <li className="text-sm text-curb-600">and {preview.more} more</li>
          )}
        </ul>

        <div className="mt-6 flex flex-col gap-2">
          <label
            htmlFor={pickerId}
            className="font-display text-sm font-semibold text-curb-800"
          >
            Move them to…
          </label>
          <select
            id={pickerId}
            className={SELECT_CLASS}
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
            disabled={busy}
          >
            <option value="">Choose a class</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <p className="text-sm text-curb-600">
            Moving sends all {decision.memberCount} student
            {decision.memberCount === 1 ? "" : "s"} in {classGroup.name} to the
            class you choose. Anyone also in another class keeps it.
          </p>
          <Button
            variant="primary"
            size="md"
            onClick={() =>
              target && onResolve({ action: "move", moveToClassId: target.id })
            }
            disabled={busy || !canMove(targetId)}
          >
            {target
              ? moveButtonLabel(decision.memberCount, target.name)
              : "Move and delete"}
          </Button>
        </div>

        <div className="mt-6 flex flex-col gap-2 border-t border-curb-200 pt-6">
          <p className="text-sm text-curb-600">
            Or delete {classGroup.name} without moving anyone.{" "}
            {decision.soleMemberCount === 1
              ? "That student"
              : `Those ${decision.soleMemberCount} students`}{" "}
            will have no class until you add one. They stay on the roster.
          </p>
          <Button
            variant="danger"
            size="md"
            onClick={() => onResolve({ action: "force" })}
            disabled={busy}
          >
            {busy ? "Working…" : "Delete anyway"}
          </Button>
        </div>

        {error && <ErrorBanner className="mt-4" message={error} />}
      </div>

      <footer className="flex justify-end rounded-b-2xl border-t border-curb-200 px-6 py-4">
        <Button variant="quiet" size="md" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </footer>
    </ModalSurface>
  );
}
