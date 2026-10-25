"use client";

import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import {
  adminApi,
  type ClassDeleteNeedsDecision,
  type RosterStudent,
} from "@/lib/admin-api";
import { ApiError } from "@/lib/api";
import {
  type DeleteChoice,
  classifyDeleteFailure,
  deleteResolution,
  otherClasses,
} from "@/lib/class-delete";
import {
  addedMessage,
  memberCountAfter,
  removedMessage,
  savedMessage,
} from "@/lib/class-feedback";
import type { ClassGroup } from "@/lib/class-groups";
import {
  type MembershipDiff,
  canOpenMembersSheet,
  memberCountLabel,
  membersPayload,
} from "@/lib/class-members";
import type { UsePinSession } from "@/lib/use-pin-session";

import { ClassDeleteDialog } from "./class-delete-dialog";
import { ClassMembersSheet } from "./class-members-sheet";

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

// A tap-sized square: the arrows are used on a phone, where a 24px target
// next to its twin is a coin toss. Hover/active tint keeps it a button.
const REORDER_CLASS =
  "focus-ring flex min-h-tap min-w-tap items-center justify-center rounded-xl text-curb-500 transition-colors duration-150 hover:bg-curb-100 hover:text-curb-900 active:bg-curb-200 disabled:opacity-30";

const INPUT_CLASS =
  "focus-ring min-h-tap w-full rounded-xl border border-curb-300 bg-curb-50 px-3.5 text-curb-900 transition-colors duration-150 placeholder:text-curb-400 hover:border-curb-400";

export interface ClassManagerProps {
  session: UsePinSession;
  classGroups: ClassGroup[];
  /** The whole roster, for the membership sheet; null until it has loaded. */
  students: RosterStudent[] | null;
  /** Class id -> member count. A class with no students may be absent. */
  classMemberCounts: Record<string, number>;
  /** Re-fetches the class list so every picker in the app stays in sync. */
  refresh: () => Promise<void>;
  /** Re-fetches the roster, whose rows and counts change with membership. */
  refreshRoster: () => Promise<void>;
}

/** A delete that needs an answer before it can go ahead. */
interface PendingDecision {
  classGroup: ClassGroup;
  decision: ClassDeleteNeedsDecision;
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
  students,
  classMemberCounts,
  refresh,
  refreshRoster,
}: ClassManagerProps) {
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [membersFor, setMembersFor] = useState<ClassGroup | null>(null);
  const [pending, setPending] = useState<PendingDecision | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  // One quiet confirmation of the last successful action; cleared on the next.
  const [status, setStatus] = useState<string | null>(null);

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "") return;

    setAdding(true);
    setAddError(null);
    setStatus(null);
    try {
      await adminApi.createClass({
        ...requireCredentials(session),
        name: trimmed,
      });
      setName("");
      await refresh();
      setStatus(addedMessage(trimmed));
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

  /**
   * Deletes a class. With no `choice` this is the plain attempt; if some
   * students would be left with no class the server answers 409 and the
   * decision dialog opens, which calls back here with the admin's choice.
   */
  async function handleDelete(classGroup: ClassGroup, choice?: DeleteChoice) {
    setBusyId(classGroup.id);
    setRowError(null);
    setDialogError(null);
    setStatus(null);
    try {
      await adminApi.deleteClass({
        ...requireCredentials(session),
        classId: classGroup.id,
        ...(choice ? deleteResolution(choice) : {}),
      });
      setConfirmingId(null);
      setPending(null);
      await Promise.all([refresh(), refreshRoster()]);
      const target =
        choice?.action === "move"
          ? classGroups.find((g) => g.id === choice.moveToClassId)
          : undefined;
      setStatus(
        removedMessage(
          classGroup.name,
          target && pending
            ? { count: pending.decision.memberCount, targetName: target.name }
            : undefined,
        ),
      );
    } catch (error: unknown) {
      const failure = classifyDeleteFailure(error);
      if (failure.kind === "decide") {
        setConfirmingId(null);
        setPending({ classGroup, decision: failure.decision });
      } else if (failure.kind === "gone") {
        // Someone else already removed it: show the sentence, drop the row.
        setConfirmingId(null);
        setPending(null);
        setRowError(failure.message);
        await Promise.all([refresh(), refreshRoster()]);
      } else if (pending !== null) {
        setDialogError(failure.message);
      } else {
        setRowError(failure.message);
      }
    } finally {
      setBusyId(null);
    }
  }

  /**
   * The inline "Remove?" confirm that opened the dialog is unmounted by then,
   * so ModalSurface has nothing to hand focus back to. Put it on the row's
   * own Remove button instead, once the dialog has gone.
   */
  function closeDecision(classId: string) {
    setPending(null);
    setDialogError(null);
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-remove-for="${classId}"]`)
        ?.focus();
    });
  }

  async function handleSaveMembers(
    classGroup: ClassGroup,
    diff: MembershipDiff,
  ) {
    setStatus(null);
    await adminApi.changeClassMembers({
      ...requireCredentials(session),
      ...membersPayload(classGroup.id, diff),
    });
    setMembersFor(null);
    await Promise.all([refresh(), refreshRoster()]);
    setStatus(
      savedMessage(
        classGroup.name,
        memberCountAfter(classMemberCounts[classGroup.id] ?? 0, diff),
      ),
    );
  }

  async function handleMove(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= classGroups.length) return;

    const reordered = [...classGroups];
    [reordered[index], reordered[target]] = [
      reordered[target],
      reordered[index],
    ];

    setBusyId(classGroups[index].id);
    setRowError(null);
    setStatus(null);
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
    <section
      id="classes"
      className="flex scroll-mt-4 flex-col gap-4 rounded-2xl border border-curb-200 bg-white p-6 shadow-card"
    >
      <div>
        <h2
          data-panel-heading
          tabIndex={-1}
          className="font-display text-2xl font-bold text-curb-900 focus:outline-none"
        >
          Classes
        </h2>
        <p className="mt-1 text-curb-600">
          These classes appear on Display, Announce and every class picker here.
          Use Students to add or remove a whole group at once, or Edit on a
          roster row to change one student.
        </p>
        <p
          role="status"
          aria-live="polite"
          className={
            status ? "mt-2 text-sm font-medium text-curb-900" : "sr-only"
          }
        >
          {status}
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
            placeholder="New class name, like Choir"
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
          hint="Add one above — it&rsquo;ll show up on every class picker in the app."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-curb-100 rounded-xl border border-curb-200">
          {classGroups.map((classGroup, index) => {
            const isConfirming = confirmingId === classGroup.id;
            const isBusy = busyId === classGroup.id;

            return (
              <li
                key={classGroup.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5"
              >
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className={REORDER_CLASS}
                    onClick={() => void handleMove(index, -1)}
                    disabled={index === 0 || isBusy}
                    aria-label={`Move ${classGroup.name} up`}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className={REORDER_CLASS}
                    onClick={() => void handleMove(index, 1)}
                    disabled={index === classGroups.length - 1 || isBusy}
                    aria-label={`Move ${classGroup.name} down`}
                  >
                    ▼
                  </button>
                </div>

                <span className="min-w-[8rem] flex-1 truncate text-curb-900">
                  {classGroup.name}
                </span>

                <span className="min-w-[5.5rem] shrink-0 font-mono text-xs text-curb-500">
                  {memberCountLabel(
                    classMemberCounts[classGroup.id],
                    students !== null,
                  )}
                </span>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setMembersFor(classGroup)}
                  aria-label={`Students in ${classGroup.name}`}
                  disabled={isBusy || !canOpenMembersSheet(students !== null)}
                  title={students === null ? "Loading the roster…" : undefined}
                >
                  Students
                </Button>

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
                      variant="secondary"
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
                    data-remove-for={classGroup.id}
                  >
                    Remove
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {membersFor !== null && students !== null && (
        <ClassMembersSheet
          classGroup={membersFor}
          classGroups={classGroups}
          students={students}
          onSave={(diff) => handleSaveMembers(membersFor, diff)}
          onClose={() => setMembersFor(null)}
        />
      )}

      {pending !== null && (
        <ClassDeleteDialog
          classGroup={pending.classGroup}
          decision={pending.decision}
          targets={otherClasses(classGroups, pending.classGroup.id)}
          busy={busyId === pending.classGroup.id}
          error={dialogError}
          onResolve={(choice) => void handleDelete(pending.classGroup, choice)}
          onCancel={() => closeDecision(pending.classGroup.id)}
        />
      )}
    </section>
  );
}
