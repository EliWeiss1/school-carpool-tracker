"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { LoadingState } from "@/components/ui/loading-state";
import { ApiError } from "@/lib/api";
import { adminApi, type StudentFields } from "@/lib/admin-api";
import type { UsePinSession } from "@/lib/use-pin-session";
import type { Carpool, Student } from "@/types/db";

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
type Editor = { mode: "add" } | { mode: "edit"; student: Student } | null;

export interface RosterManagerProps {
  session: UsePinSession;
  /** null while the first load is in flight. */
  students: Student[] | null;
  /** For the carpool column and the student form's carpool picker. */
  carpools: Carpool[];
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
  listError,
  refresh,
}: RosterManagerProps) {
  const [editor, setEditor] = useState<Editor>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  async function handleDelete(student: Student) {
    setDeletingId(student.id);
    setDeleteError(null);
    try {
      await adminApi.deleteStudent({
        ...requireCredentials(session),
        studentId: student.id,
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
        <RosterTable
          students={students}
          carpools={carpools}
          onEdit={(student) => {
            setFormError(null);
            setEditor({ mode: "edit", student });
          }}
          onDelete={handleDelete}
          deletingId={deletingId}
        />
      )}
    </section>
  );
}
