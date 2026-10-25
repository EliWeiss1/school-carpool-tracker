"use client";

import { useId, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import type { RosterStudent } from "@/lib/admin-api";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { ClassGroup } from "@/lib/class-groups";
import {
  type MemberScope,
  countLeftWithNoClass,
  describeDiff,
  diffMembership,
  filterStudents,
  hasChanges,
  memberIdsOf,
  type MembershipDiff,
  classPickOf,
  scopeForClassPick,
  studentClassesLine,
} from "@/lib/class-members";

import { ModalSurface } from "./modal-surface";

const INPUT_CLASS =
  "focus-ring min-h-tap w-full rounded-xl border border-curb-300 bg-curb-50 px-3.5 text-curb-900 transition-colors duration-150 placeholder:text-curb-400 hover:border-curb-400";

const SELECT_CLASS =
  "focus-ring min-h-tap rounded-xl border border-curb-300 bg-curb-50 px-3.5 text-curb-900 transition-colors duration-150 hover:border-curb-400";

const CHIP_BASE =
  "focus-ring flex min-h-tap shrink-0 items-center rounded-xl border px-3.5 font-mono text-sm transition-[transform,background-color,border-color] duration-150 ease-spring hover:border-curb-400 hover:bg-curb-50 active:scale-[0.98]";

export interface ClassMembersSheetProps {
  classGroup: ClassGroup;
  /** Every class, for the "Show students in…" dropdown. */
  classGroups: readonly ClassGroup[];
  students: readonly RosterStudent[];
  /** Applies the diff and refreshes; rejects with an ApiError to show its sentence. */
  onSave: (diff: MembershipDiff) => Promise<void>;
  onClose: () => void;
}

interface ScopeChip {
  key: string;
  label: string;
  scope: MemberScope;
}

/** The three scopes about THIS class; any other class is the dropdown's job. */
const SCOPE_CHIPS: readonly ScopeChip[] = [
  { key: "all", label: "All", scope: "all" },
  { key: "in", label: "In this class", scope: "in" },
  { key: "out", label: "Not in this class", scope: "out" },
];

/**
 * The membership editor for one class: every student with a checkbox, ticked
 * when they are in it. Search, three scope chips and a "Show students in…"
 * class dropdown narrow the list (so "everyone in 3rd" is one pick, which is
 * how a new group is usually built), "Select all
 * shown" ticks what is visible, and a sticky footer says what Save will do.
 * Unticking removes, so the same sheet adds and removes. Cancel discards.
 *
 * The tick state lives here as a set of ids; the rules (diff, filter, wording)
 * are the pure functions in `lib/class-members.ts`.
 */
export function ClassMembersSheet({
  classGroup,
  classGroups,
  students,
  onSave,
  onClose,
}: ClassMembersSheetProps) {
  const titleId = useId();
  const searchId = useId();
  const classFilterId = useId();
  // Snapshot once, at open. `chosen` starts from the same set, so a roster
  // refresh while the sheet is open can never make the two drift apart and
  // read as "remove everyone". The list below may still show fresher rows.
  const [original] = useState<Set<string>>(() =>
    memberIdsOf(students, classGroup.name),
  );
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(original));
  const [text, setText] = useState("");
  const [scope, setScope] = useState<MemberScope>("all");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = useMemo(
    () =>
      filterStudents(students, {
        text,
        scope,
        classId: classGroup.id,
        className: classGroup.name,
      }),
    [students, text, scope, classGroup.id, classGroup.name],
  );
  const diff = useMemo(
    () => diffMembership(original, chosen),
    [original, chosen],
  );
  const changed = hasChanges(diff);
  const allShownChosen =
    shown.length > 0 && shown.every((s) => chosen.has(s.id));

  const otherClassGroups = classGroups.filter((g) => g.id !== classGroup.id);
  // The dropdown shows its "All classes" default whenever a chip (or nothing
  // specific) is the active scope, and a class name when one is picked.
  const pickedClassName = classPickOf(scope);
  // Only the removals can strand someone; additions go into this class.
  const stranded = countLeftWithNoClass(students, diff.remove, classGroup.name);

  function toggle(id: string, on: boolean) {
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAllShown() {
    setChosen((current) => {
      const next = new Set(current);
      for (const s of shown) {
        if (allShownChosen) next.delete(s.id);
        else next.add(s.id);
      }
      return next;
    });
  }

  async function handleSave() {
    if (!changed) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(diff);
    } catch (caught: unknown) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not save these changes. Try again.",
      );
      setSaving(false);
    }
    // On success the parent unmounts the sheet, so there is nothing to reset.
  }

  return (
    <ModalSurface
      labelledBy={titleId}
      onClose={onClose}
      dismissible={!saving}
      dismissOnBackdrop={!changed}
      initialFocusSelector='input[type="search"]'
      className="sm:max-w-2xl"
    >
      <header className="flex flex-col gap-1 px-6 pb-3 pt-6">
        <p className="font-mono text-xs uppercase tracking-eyebrow text-curb-500">
          Class members
        </p>
        <h2
          id={titleId}
          className="font-display text-2xl font-bold text-curb-900"
        >
          Students in {classGroup.name}
        </h2>
        <p className="text-sm text-curb-600">
          {original.size} in this class now. Tick to add, untick to remove, then
          save.
        </p>
      </header>

      <div className="flex flex-col gap-3 border-b border-curb-200 px-6 pb-4">
        <div>
          <label htmlFor={searchId} className="sr-only">
            Search students by name or alias
          </label>
          <input
            id={searchId}
            type="search"
            className={INPUT_CLASS}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Search by name or alias"
            autoComplete="off"
          />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div
            role="group"
            aria-label="Show"
            className="-mx-6 flex gap-2 overflow-x-auto px-6 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0"
          >
            {SCOPE_CHIPS.map((chip) => {
              const active = scope === chip.scope;
              return (
                <button
                  key={chip.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setScope(chip.scope)}
                  className={cn(
                    CHIP_BASE,
                    active
                      ? "border-marigold-500 bg-white font-semibold text-curb-900 shadow-card hover:border-marigold-600 hover:bg-marigold-50"
                      : "border-curb-300 bg-curb-50 text-curb-700",
                  )}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <label
              htmlFor={classFilterId}
              className="shrink-0 font-display text-sm font-semibold text-curb-800"
            >
              Show students in…
            </label>
            <select
              id={classFilterId}
              className={cn(
                SELECT_CLASS,
                pickedClassName !== "" &&
                  "border-marigold-500 bg-white font-semibold shadow-card",
              )}
              value={pickedClassName}
              onChange={(event) =>
                setScope(scopeForClassPick(event.target.value))
              }
            >
              <option value="">All classes</option>
              {otherClassGroups.map((g) => (
                <option key={g.id} value={g.name}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-curb-600" aria-live="polite">
            Showing {shown.length} of {students.length}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={toggleAllShown}
            disabled={shown.length === 0 || saving}
          >
            {allShownChosen ? "Clear all shown" : "Select all shown"}
          </Button>
        </div>
      </div>

      <div className="min-h-[12rem] flex-1 overflow-y-auto">
        {shown.length === 0 ? (
          <p className="px-6 py-8 text-center text-curb-600">
            No students match. Try a different name or filter.
          </p>
        ) : (
          <ul className="divide-y divide-curb-100">
            {shown.map((student) => {
              const checked = chosen.has(student.id);
              const wasMember = original.has(student.id);
              const pending =
                checked && !wasMember
                  ? "Will be added"
                  : !checked && wasMember
                    ? "Will be removed"
                    : null;

              return (
                <li key={student.id}>
                  <label
                    className={cn(
                      "flex min-h-tap cursor-pointer items-center gap-3 px-6 py-2 transition-colors duration-150 hover:bg-curb-50 active:bg-curb-100",
                      pending !== null && "bg-marigold-50 hover:bg-marigold-50",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={checked}
                      onChange={(event) =>
                        toggle(student.id, event.target.checked)
                      }
                    />
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 text-sm leading-none",
                        "peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-marigold-500",
                        checked
                          ? "border-marigold-500 bg-marigold-500 text-curb-900"
                          : "border-curb-400 bg-white text-transparent",
                      )}
                    >
                      &#10003;
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium text-curb-900">
                        {student.first_name} {student.last_name}
                      </span>
                      <span className="truncate font-mono text-xs text-curb-500">
                        {studentClassesLine(
                          student.class_groups,
                          classGroup.name,
                          checked || wasMember,
                        )}
                      </span>
                    </span>
                    {pending !== null && (
                      <span className="shrink-0 font-mono text-xs uppercase tracking-eyebrow text-curb-600">
                        {pending}
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <footer className="flex flex-col gap-3 rounded-b-2xl border-t border-curb-200 bg-white px-6 py-4">
        {error && <ErrorBanner message={error} />}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p
            className="font-medium text-curb-900"
            aria-live="polite"
            data-testid="members-diff"
          >
            {describeDiff(diff, stranded)}
          </p>
          <div className="flex gap-2">
            <Button
              variant="quiet"
              size="md"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => void handleSave()}
              disabled={!changed || saving}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </footer>
    </ModalSurface>
  );
}
