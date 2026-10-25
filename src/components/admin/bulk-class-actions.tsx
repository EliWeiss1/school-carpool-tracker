"use client";

import { type ReactNode, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { ApiError } from "@/lib/api";
import { type BulkClassMode, bulkConfirmText } from "@/lib/bulk-class";
import type { ClassGroup } from "@/lib/class-groups";

const SELECT_CLASS =
  "focus-ring min-h-tap w-full rounded-xl border border-curb-300 bg-white px-3.5 text-curb-900 transition-colors duration-150 hover:border-curb-400";

export interface BulkClassActionsProps {
  classGroups: readonly ClassGroup[];
  /** How many roster rows are ticked. */
  selectedCount: number;
  /** Applies the action; rejects with an ApiError to show its sentence inline. */
  onApply: (mode: BulkClassMode, classGroup: ClassGroup) => Promise<void>;
  /**
   * How many of the ticked students would be left in no class if removed from
   * the named class. Lets the Remove confirmation say so instead of stranding
   * anyone silently.
   */
  strandedIn: (className: string) => number;
  /**
   * Further actions to sit after the two triggers (the roster's "Remove from
   * roster"). Rendered only while no class panel is open, so a destructive
   * button never sits right under the panel's own Cancel.
   */
  children?: ReactNode;
}

/**
 * "Add to class…" / "Remove from class…" for the roster's ticked rows. Meant
 * to sit inside the selection bar (a wrapping flex row): it renders the two
 * trigger buttons, and once one is pressed swaps them for a full-width panel
 * with a class picker and a confirmation that states the count (and how many
 * would be left with no class, for Remove). Which request
 * is sent is `lib/bulk-class.ts`; this only collects the choice.
 */
export function BulkClassActions({
  classGroups,
  selectedCount,
  onApply,
  strandedIn,
  children,
}: BulkClassActionsProps) {
  const pickerId = useId();
  const [mode, setMode] = useState<BulkClassMode | null>(null);
  const [classId, setClassId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = classGroups.find((g) => g.id === classId);

  function open(next: BulkClassMode) {
    setMode(next);
    setClassId("");
    setError(null);
  }

  async function confirm() {
    if (mode === null || chosen === undefined) return;
    setBusy(true);
    setError(null);
    try {
      await onApply(mode, chosen);
      setMode(null);
    } catch (caught: unknown) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not change that class. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (mode === null) {
    return (
      <>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => open("add")}
          disabled={classGroups.length === 0}
        >
          Add to class…
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => open("remove")}
          disabled={classGroups.length === 0}
        >
          Remove from class…
        </Button>
        {children}
      </>
    );
  }

  return (
    <div className="flex basis-full flex-col gap-3 rounded-xl border border-curb-200 bg-white p-4">
      <label
        htmlFor={pickerId}
        className="font-display text-sm font-semibold text-curb-800"
      >
        {mode === "add" ? "Add to which class?" : "Remove from which class?"}
      </label>
      <select
        id={pickerId}
        className={SELECT_CLASS}
        value={classId}
        onChange={(event) => setClassId(event.target.value)}
        disabled={busy}
      >
        <option value="">Choose a class</option>
        {classGroups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>

      {chosen && (
        <p className="font-medium text-curb-900" aria-live="polite">
          {bulkConfirmText(
            mode,
            selectedCount,
            chosen.name,
            mode === "remove" ? strandedIn(chosen.name) : 0,
          )}
        </p>
      )}
      {error && <ErrorBanner message={error} />}

      <div className="flex justify-end gap-2">
        <Button
          variant="quiet"
          size="md"
          onClick={() => setMode(null)}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          onClick={() => void confirm()}
          disabled={busy || chosen === undefined}
        >
          {busy
            ? "Working…"
            : mode === "add"
              ? "Add to class"
              : "Remove from class"}
        </Button>
      </div>
    </div>
  );
}
