"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { LoadingState } from "@/components/ui/loading-state";
import { ApiError } from "@/lib/api";
import { adminApi, type RosterStudent, type StudentFields } from "@/lib/admin-api";
import type { UsePinSession } from "@/lib/use-pin-session";
import type { Carpool } from "@/types/db";

import { RosterTable } from "./roster-table";
import { StudentForm } from "./student-form";

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

/** What editor is open, if any: a fresh form, or an edit of one row. */
type Editor =
  | { mode: "add" }
  | { mode: "edit"; student: RosterStudent }
  | null;

export interface RosterManagerProps {
  session: UsePinSession;
  /** null while the first load is in flight. */
  students: RosterStudent[] | null;
  /** For the carpool column and the student form's carpool picker. */
  carpools: Carpool[];
  /** The admin-editable class list, in display order. */
  classGroups: string[];
  listError: string | null;
  /** Re-fetches the roster. Shared with the import and reset panels so all
   *  three sections of /admin always agree on the current state. */
  refresh: () => Promise<void>;
}

/**
 * The roster CRUD surface: list, add, edit, remove. The list itself is owned
 * by `AdminDashboard` (so the reset panel can show an accurate arrived count
 * from the same data) -- this component only owns the add/edit/delete UI
 * state and refetches through the shared `refresh` after every write.
 */
export function RosterManager({
  session,
  students,
  carpools,
  classGroups,
  listError,
  refresh,
}: RosterManagerProps) {
  const [editor, setEditor] = useState<Editor>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirming, setBulkConfirming] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkInfo, setBulkInfo] = useState<string | null>(null);

  async function handleSubmit(fields: StudentFields) {
    setSubmitting(true);
    setFormError(null);
    try {
      if (editor?.mode === "edit") {
        await adminApi.updateStudent({
          ...requireCredentials(session),
          studentId: editor.student.id,
          ...fields,
        });
      } else {
        await adminApi.createStudent({
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
          : "Could not save that student. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(student: RosterStudent) {
    setDeletingId(student.id);
    setDeleteError(null);
    try {
      await adminApi.deleteStudent({
        ...requireCredentials(session),
        studentId: student.id,
      });
      setSelectedIds((prev) => {
        if (!prev.has(student.id)) return prev;
        const next = new Set(prev);
        next.delete(student.id);
        return next;
      });
      await refresh();
    } catch (error: unknown) {
      setDeleteError(
        error instanceof ApiError
          ? error.message
          : "Could not remove that student. Try again.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  async function handleBulkDelete() {
    setBulkDeleting(true);
    setDeleteError(null);
    try {
      const result = await adminApi.deleteStudents({
        ...requireCredentials(session),
        studentIds: [...selectedIds],
      });
      setBulkInfo(
        result.missingIds.length > 0
          ? `Removed ${result.deletedIds.length} student${result.deletedIds.length === 1 ? "" : "s"} (${result.missingIds.length} were already gone).`
          : `Removed ${result.deletedIds.length} student${result.deletedIds.length === 1 ? "" : "s"}.`,
      );
      setSelectedIds(new Set());
      setBulkConfirming(false);
      await refresh();
    } catch (error: unknown) {
      setDeleteError(
        error instanceof ApiError
          ? error.message
          : "Could not remove those students. Try again.",
      );
    } finally {
      setBulkDeleting(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-curb-900">
            Roster
          </h2>
          <p className="text-curb-600">
            {students !== null
              ? `${students.length} student${students.length === 1 ? "" : "s"} enrolled`
              : listError !== null
                ? "Could not load"
                : "Loading…"}
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
            Add student
          </Button>
        )}
      </div>

      {editor !== null && (
        <StudentForm
          student={editor.mode === "edit" ? editor.student : undefined}
          carpools={carpools}
          classGroups={classGroups}
          onCancel={() => setEditor(null)}
          onSubmit={handleSubmit}
          submitting={submitting}
          error={formError}
        />
      )}

      {listError && (
        <ErrorBanner
          message={listError}
          retry={{ label: "Retry", onClick: () => void refresh() }}
        />
      )}

      {deleteError && <ErrorBanner message={deleteError} />}
      {bulkInfo && <ErrorBanner tone="warning" message={bulkInfo} />}

      {students === null && listError === null && (
        <LoadingState label="Loading the roster" rows={5} />
      )}

      {students !== null && students.length === 0 && (
        <EmptyState
          title="No students yet"
          hint="Add a student above, or import a roster CSV below."
        />
      )}

      {students !== null && students.length > 0 && (
        <>
          {selectedIds.size > 0 &&
            (bulkConfirming ? (
              <div className="flex flex-col gap-3 rounded-xl border border-waiting bg-white p-4">
                <p className="font-medium text-curb-900">
                  Remove {selectedIds.size} student
                  {selectedIds.size === 1 ? "" : "s"} from the roster? This
                  can&apos;t be undone.
                </p>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="quiet"
                    size="md"
                    onClick={() => setBulkConfirming(false)}
                    disabled={bulkDeleting}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    size="md"
                    onClick={() => void handleBulkDelete()}
                    disabled={bulkDeleting}
                  >
                    {bulkDeleting
                      ? "Removing…"
                      : `Yes, remove ${selectedIds.size}`}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-xl border border-curb-200 bg-curb-50 px-4 py-3">
                <span className="text-sm text-curb-700">
                  {selectedIds.size} selected
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="quiet"
                    size="sm"
                    onClick={() => setSelectedIds(new Set())}
                  >
                    Clear
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      setBulkInfo(null);
                      setBulkConfirming(true);
                    }}
                  >
                    Delete {selectedIds.size} selected
                  </Button>
                </div>
              </div>
            ))}

          <RosterTable
            students={students}
            carpools={carpools}
            onEdit={(student) => {
              setFormError(null);
              setEditor({ mode: "edit", student });
            }}
            onDelete={handleDelete}
            deletingId={deletingId}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
          />
        </>
      )}
    </section>
  );
}
