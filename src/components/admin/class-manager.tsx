"use client";

import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { adminApi } from "@/lib/admin-api";
import { ApiError } from "@/lib/api";
import type { ClassGroup } from "@/lib/class-groups";
import type { UsePinSession } from "@/lib/use-pin-session";

function requireCredentials(session: UsePinSession) {
  const credentials = session.credentials();
  if (credentials === null) {
    throw new ApiError(
      "pin",
      401,
      "The staff session timed out. Enter the PIN again.",
    );
  }
  return credentials;
}

const INPUT_CLASS =
  "focus-ring min-h-tap w-full rounded-xl border border-curb-300 bg-curb-50 px-3.5 text-curb-900 transition-colors duration-150 placeholder:text-curb-400 hover:border-curb-400";

export interface ClassManagerProps {
  session: UsePinSession;
  classGroups: ClassGroup[];
  /** Re-fetches the class list so every picker in the app stays in sync. */
  refresh: () => Promise<void>;
}

/**
 * The admin-editable class list -- replaces what used to be a hardcoded
 * array in code. Deleting a class here never touches a student already
 * carrying that value (see the class_groups migration); it only removes the
 * option from future pickers.
 *
 * Reordering is up/down buttons per row, not drag-and-drop: the practical,
 * accessible equivalent for a list that is at most a few dozen rows and
 * reordered rarely.
 */
export function ClassManager({
  session,
  classGroups,
  refresh,
}: ClassManagerProps) {
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "") return;

    setAdding(true);
    setAddError(null);
    try {
      await adminApi.createClass({
        ...requireCredentials(session),
        name: trimmed,
      });
      setName("");
      await refresh();
    } catch (error: unknown) {
      setAddError(
        error instanceof ApiError
          ? error.message
          : "Could not add that class. Try again.",
      );
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(classGroup: ClassGroup) {
    setBusyId(classGroup.id);
    setRowError(null);
    try {
      await adminApi.deleteClass({
        ...requireCredentials(session),
        classId: classGroup.id,
      });
      setConfirmingId(null);
      await refresh();
    } catch (error: unknown) {
      setRowError(
        error instanceof ApiError
          ? error.message
          : "Could not remove that class. Try again.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleMove(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= classGroups.length) return;

    const reordered = [...classGroups];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];

    setBusyId(classGroups[index].id);
    setRowError(null);
    try {
      await adminApi.reorderClasses({
        ...requireCredentials(session),
        orderedIds: reordered.map((group) => group.id),
      });
      await refresh();
    } catch (error: unknown) {
      setRowError(
        error instanceof ApiError
          ? error.message
          : "Could not reorder the class list. Try again.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-curb-200 bg-white p-6 shadow-card">
      <div>
        <h2 className="font-display text-2xl font-bold text-curb-900">
          Classes
        </h2>
        <p className="mt-1 text-curb-600">
          The classes offered on every class picker. Add, remove, or reorder
          them here -- editing a student&apos;s own class is still done from the
          roster above.
        </p>
      </div>

      <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
          <label htmlFor="class-manager-name" className="sr-only">
            New class name
          </label>
          <input
            id="class-manager-name"
            className={INPUT_CLASS}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="EC Hummingbirds"
          />
        </div>
        <Button
          type="submit"
          variant="primary"
          size="md"
          disabled={adding || name.trim() === ""}
        >
          {adding ? "Adding…" : "Add class"}
        </Button>
      </form>

      {addError && <ErrorBanner message={addError} />}
      {rowError && <ErrorBanner message={rowError} />}

      {classGroups.length === 0 ? (
        <EmptyState
          title="No classes yet"
          hint="Add one above -- it&rsquo;ll show up on every class picker in the app."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-curb-100 rounded-xl border border-curb-200">
          {classGroups.map((classGroup, index) => {
            const isConfirming = confirmingId === classGroup.id;
            const isBusy = busyId === classGroup.id;

            return (
              <li
                key={classGroup.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="focus-ring rounded-md p-1 text-curb-500 transition-colors duration-150 hover:text-curb-900 disabled:opacity-30"
                    onClick={() => void handleMove(index, -1)}
                    disabled={index === 0 || isBusy}
                    aria-label={`Move ${classGroup.name} up`}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className="focus-ring rounded-md p-1 text-curb-500 transition-colors duration-150 hover:text-curb-900 disabled:opacity-30"
                    onClick={() => void handleMove(index, 1)}
                    disabled={index === classGroups.length - 1 || isBusy}
                    aria-label={`Move ${classGroup.name} down`}
                  >
                    ▼
                  </button>
                </div>

                <span className="flex-1 truncate text-curb-900">
                  {classGroup.name}
                </span>

                {isConfirming ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-curb-600">Remove?</span>
                    <Button
                      variant="quiet"
                      size="sm"
                      onClick={() => setConfirmingId(null)}
                      disabled={isBusy}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => void handleDelete(classGroup)}
                      disabled={isBusy}
                    >
                      {isBusy ? "Removing…" : "Remove"}
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="quiet"
                    size="sm"
                    onClick={() => setConfirmingId(classGroup.id)}
                  >
                    Remove
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
