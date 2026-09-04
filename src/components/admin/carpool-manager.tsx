"use client";

import { type FormEvent, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { adminApi } from "@/lib/admin-api";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { UsePinSession } from "@/lib/use-pin-session";
import type { Carpool, Student } from "@/types/db";

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

/** Splits on comma or semicolon, same rule the student form's aliases field uses. */
function parseAliasesInput(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

const INPUT_CLASS =
  "focus-ring min-h-tap w-full rounded-xl border border-curb-300 bg-curb-50 px-3.5 text-curb-900 transition-colors duration-150 placeholder:text-curb-400 hover:border-curb-400";
const LABEL_CLASS = "text-sm font-semibold text-curb-700";

type Editor = { mode: "add" } | { mode: "edit"; carpool: Carpool } | null;

function CarpoolEditor({
  carpool,
  students,
  onCancel,
  onSubmit,
  submitting,
  error,
}: {
  carpool?: Carpool;
  students: Student[];
  onCancel: () => void;
  onSubmit: (fields: {
    name: string;
    aliases: string[];
    memberIds: string[];
  }) => Promise<void>;
  submitting: boolean;
  error: string | null;
}) {
  const [name, setName] = useState(carpool?.name ?? "");
  const [aliasesText, setAliasesText] = useState(
    (carpool?.aliases ?? []).join(", "),
  );
  const [memberIds, setMemberIds] = useState<Set<string>>(
    () =>
      new Set(
        carpool
          ? students
              .filter((student) => student.carpool_id === carpool.id)
              .map((student) => student.id)
          : [],
      ),
  );
  const formId = useId();

  function toggleMember(id: string) {
    setMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onSubmit({
      name: name.trim(),
      aliases: parseAliasesInput(aliasesText),
      memberIds: [...memberIds],
    });
  }

  // A student already in a DIFFERENT carpool is still selectable -- checking
  // them here moves them, since a child can only ride in one carpool at a
  // time -- but it is called out so nobody moves a sibling by accident.
  const otherCarpoolStudents = new Set(
    students
      .filter(
        (student) =>
          student.carpool_id !== null && student.carpool_id !== carpool?.id,
      )
      .map((student) => student.id),
  );

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-4 rounded-2xl border border-marigold-300 bg-marigold-50 p-6 shadow-card"
    >
      <h3 className="font-display text-lg font-bold text-curb-900">
        {carpool ? `Edit ${carpool.name}` : "Add a carpool"}
      </h3>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label className={LABEL_CLASS} htmlFor={`${formId}-name`}>
            Carpool name
          </label>
          <input
            id={`${formId}-name`}
            className={INPUT_CLASS}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Weiss Carpool"
            required
            autoFocus
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={LABEL_CLASS} htmlFor={`${formId}-aliases`}>
            Aliases
          </label>
          <input
            id={`${formId}-aliases`}
            className={cn(INPUT_CLASS, "font-mono text-sm")}
            value={aliasesText}
            onChange={(event) => setAliasesText(event.target.value)}
            placeholder="Minivan 3, The Weiss van"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={LABEL_CLASS}>
          Members ({memberIds.size} selected)
        </span>
        <p className="text-xs text-curb-500">
          Announcing any one of these, or the carpool name itself, will offer
          to mark everyone here arrived in one tap.
        </p>
        <div className="max-h-64 overflow-y-auto rounded-xl border border-curb-300 bg-white p-2">
          {students.length === 0 ? (
            <p className="p-2 text-sm text-curb-500">
              No students on the roster yet.
            </p>
          ) : (
            <ul className="flex flex-col">
              {students.map((student) => (
                <li key={student.id}>
                  <label className="flex min-h-tap cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-curb-50">
                    <input
                      type="checkbox"
                      className="h-5 w-5 shrink-0 accent-marigold-500"
                      checked={memberIds.has(student.id)}
                      onChange={() => toggleMember(student.id)}
                    />
                    <span className="min-w-0 flex-1 truncate text-curb-900">
                      {student.first_name} {student.last_name}
                    </span>
                    {otherCarpoolStudents.has(student.id) && (
                      <span className="shrink-0 font-mono text-[0.6875rem] uppercase tracking-eyebrow text-curb-500">
                        In another carpool
                      </span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="flex justify-end gap-2">
        <Button variant="quiet" size="md" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="md" disabled={submitting}>
          {submitting ? "Saving…" : carpool ? "Save changes" : "Add carpool"}
        </Button>
      </div>
    </form>
  );
}

export interface CarpoolManagerProps {
  session: UsePinSession;
  carpools: Carpool[];
  /** For the member picker and each carpool's member count. */
  students: Student[];
  /** Re-fetches the roster so this panel and the table above stay in sync. */
  refresh: () => Promise<void>;
}

/**
 * Setup and editing for carpools: create, rename, edit aliases, assign
 * members, delete. The student form has its own carpool dropdown for a
 * one-off mid-year change -- this panel is for setting several up at once and
 * seeing the whole grouping in one place.
 */
export function CarpoolManager({
  session,
  carpools,
  students,
  refresh,
}: CarpoolManagerProps) {
  const [editor, setEditor] = useState<Editor>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  );
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const membersByCarpool = new Map<string, Student[]>();
  for (const student of students) {
    if (!student.carpool_id) continue;
    const list = membersByCarpool.get(student.carpool_id) ?? [];
    list.push(student);
    membersByCarpool.set(student.carpool_id, list);
  }

  async function handleSubmit(fields: {
    name: string;
    aliases: string[];
    memberIds: string[];
  }) {
    setSubmitting(true);
    setFormError(null);
    try {
      if (editor?.mode === "edit") {
        await adminApi.updateCarpool({
          ...requireCredentials(session),
          carpoolId: editor.carpool.id,
          ...fields,
        });
      } else {
        await adminApi.createCarpool({
          ...requireCredentials(session),
          ...fields,
        });
      }
      setEditor(null);
      await refresh();
    } catch (error: unknown) {
      setFormError(
        error instanceof ApiError
          ? error.message
          : "Could not save that carpool. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(carpool: Carpool) {
    setDeletingId(carpool.id);
    setDeleteError(null);
    try {
      await adminApi.deleteCarpool({
        ...requireCredentials(session),
        carpoolId: carpool.id,
      });
      setConfirmingDeleteId(null);
      await refresh();
    } catch (error: unknown) {
      setDeleteError(
        error instanceof ApiError
          ? error.message
          : "Could not remove that carpool. Try again.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-curb-900">
            Carpools
          </h2>
          <p className="text-curb-600">
            Link siblings or a shared ride so announcing one calls the whole
            group.
          </p>
        </div>
        {editor === null && (
          <Button
            variant="primary"
            size="md"
            onClick={() => {
              setFormError(null);
              setEditor({ mode: "add" });
            }}
          >
            Add carpool
          </Button>
        )}
      </div>

      {editor !== null && (
        <CarpoolEditor
          carpool={editor.mode === "edit" ? editor.carpool : undefined}
          students={students}
          onCancel={() => setEditor(null)}
          onSubmit={handleSubmit}
          submitting={submitting}
          error={formError}
        />
      )}

      {deleteError && <ErrorBanner message={deleteError} />}

      {carpools.length === 0 && editor === null && (
        <EmptyState
          title="No carpools yet"
          hint="Add one above to link siblings or a shared ride together."
        />
      )}

      {carpools.length > 0 && (
        <ul className="flex flex-col gap-3">
          {carpools.map((carpool) => {
            const members = membersByCarpool.get(carpool.id) ?? [];
            const isConfirmingDelete = confirmingDeleteId === carpool.id;
            const isDeleting = deletingId === carpool.id;

            return (
              <li
                key={carpool.id}
                className="rounded-2xl border border-curb-200 bg-white p-4 shadow-card"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-display text-lg font-bold text-curb-900">
                      {carpool.name}
                    </p>
                    {carpool.aliases.length > 0 && (
                      <p className="font-mono text-xs text-curb-500">
                        also called: {carpool.aliases.join(", ")}
                      </p>
                    )}
                    <p className="mt-1 truncate text-sm text-curb-700">
                      {members.length === 0
                        ? "No members yet"
                        : members
                            .map((s) => `${s.first_name} ${s.last_name}`)
                            .join(" · ")}
                    </p>
                  </div>

                  {isConfirmingDelete ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-curb-600">Remove?</span>
                      <Button
                        variant="quiet"
                        size="sm"
                        onClick={() => setConfirmingDeleteId(null)}
                        disabled={isDeleting}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => void handleDelete(carpool)}
                        disabled={isDeleting}
                      >
                        {isDeleting ? "Removing…" : "Remove"}
                      </Button>
                    </div>
                  ) : (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setFormError(null);
                          setEditor({ mode: "edit", carpool });
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="quiet"
                        size="sm"
                        onClick={() => setConfirmingDeleteId(carpool.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
