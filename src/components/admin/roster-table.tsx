"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { Student } from "@/types/db";

import { StatusPill } from "./status-pill";

export interface RosterTableProps {
  students: Student[];
  onEdit: (student: Student) => void;
  onDelete: (student: Student) => Promise<void>;
  /** The row currently mid-delete, so its button can say "Removing…". */
  deletingId: string | null;
}

/**
 * The roster, one row per student. Grade and class are set in
 * `font-mono` -- CLAUDE.md calls these out by name as one of the few things
 * in the app meant to line up in columns, the same rule a CSV row number or a
 * device id follows.
 *
 * Delete has no undo anywhere in the app, so it is the one action here with
 * its own inline confirmation rather than firing on the first click.
 */
export function RosterTable({
  students,
  onEdit,
  onDelete,
  deletingId,
}: RosterTableProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto rounded-2xl border border-curb-200 bg-white shadow-card">
      <table className="w-full min-w-[640px] border-collapse text-left">
        <thead>
          <tr className="border-b border-curb-200 bg-curb-50 text-xs uppercase tracking-eyebrow text-curb-500">
            <th className="px-4 py-3 font-semibold">Name</th>
            <th className="px-4 py-3 font-semibold">Aliases</th>
            <th className="px-4 py-3 font-semibold">Grade</th>
            <th className="px-4 py-3 font-semibold">Class</th>
            <th className="px-4 py-3 font-semibold">Status</th>
            <th className="px-4 py-3 font-semibold">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {students.map((student) => {
            const isConfirming = confirmingId === student.id;
            const isDeleting = deletingId === student.id;

            return (
              <tr
                key={student.id}
                className="border-b border-curb-100 last:border-b-0 hover:bg-curb-50"
              >
                <td className="px-4 py-3 font-medium text-curb-900">
                  {student.first_name} {student.last_name}
                </td>
                <td className="px-4 py-3 text-curb-600">
                  {student.aliases.length > 0 ? (
                    <span className="font-mono text-xs">
                      {student.aliases.join(", ")}
                    </span>
                  ) : (
                    <span className="text-curb-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-sm text-curb-700">
                  {student.grade ?? <span className="text-curb-400">—</span>}
                </td>
                <td className="px-4 py-3 font-mono text-sm text-curb-700">
                  {student.class_group ?? (
                    <span className="text-curb-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <StatusPill status={student.status} />
                </td>
                <td className={cn("px-4 py-3", isConfirming && "min-w-[220px]")}>
                  {isConfirming ? (
                    <div className="flex items-center justify-end gap-2">
                      <span className="text-xs text-curb-600">Remove?</span>
                      <Button
                        variant="quiet"
                        size="sm"
                        onClick={() => setConfirmingId(null)}
                        disabled={isDeleting}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={async () => {
                          await onDelete(student);
                          setConfirmingId(null);
                        }}
                        disabled={isDeleting}
                      >
                        {isDeleting ? "Removing…" : "Remove"}
                      </Button>
                    </div>
                  ) : (
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => onEdit(student)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="quiet"
                        size="sm"
                        onClick={() => setConfirmingId(student.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
