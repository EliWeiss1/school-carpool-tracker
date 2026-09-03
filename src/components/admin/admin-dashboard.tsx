"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PinGate } from "@/components/ui/pin-gate";
import { adminApi } from "@/lib/admin-api";
import { ApiError } from "@/lib/api";
import { usePinSession } from "@/lib/use-pin-session";
import type { Student } from "@/types/db";

import { CsvImportPanel } from "./csv-import-panel";
import { ResetPanel } from "./reset-panel";
import { RosterManager } from "./roster-manager";

/**
 * /admin's content, once the staff PIN has unlocked the tab.
 *
 * Owns the one piece of state every section below needs to agree on: the
 * current roster. The reset panel's confirmation names an exact student
 * count, and it has to be the same count the table above is showing, so this
 * fetch lives here once rather than three times in three components that
 * could drift out of sync with each other between renders.
 */
function AdminContent() {
  const session = usePinSession();
  const [students, setStudents] = useState<Student[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const credentials = session.credentials();
    if (credentials === null) {
      setListError("The staff session timed out. Enter the PIN again.");
      return;
    }

    setListError(null);
    try {
      const { students: rows } = await adminApi.listRoster(credentials);
      setStudents(
        [...rows].sort((a, b) =>
          `${a.last_name} ${a.first_name}`.localeCompare(
            `${b.last_name} ${b.first_name}`,
          ),
        ),
      );
    } catch (error: unknown) {
      setListError(
        error instanceof ApiError
          ? error.message
          : "Could not load the roster. Try again in a moment.",
      );
    }
    // usePinSession().credentials is stable across renders (see use-pin-session.ts);
    // session itself is a fresh object each render, so it is deliberately not
    // a dependency, or this would refetch on every keystroke elsewhere on the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <main className="min-h-screen bg-curb-50 pb-24">
      <PageHeader
        eyebrow="In the office"
        title="Admin"
        action={
          <Button variant="quiet-ink" size="sm" onClick={session.lock}>
            Lock
          </Button>
        }
      />

      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-8 sm:px-12">
        <RosterManager
          session={session}
          students={students}
          listError={listError}
          refresh={refresh}
        />
        <CsvImportPanel session={session} onImported={refresh} />
        <ResetPanel session={session} students={students} onReset={refresh} />
      </div>
    </main>
  );
}

export function AdminDashboard() {
  return (
    <PinGate purpose="Manage the roster, import a CSV, or reset the board.">
      <AdminContent />
    </PinGate>
  );
}
