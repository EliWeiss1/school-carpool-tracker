"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { RosterStudent } from "@/lib/admin-api";
import { cn } from "@/lib/cn";
import type { Carpool } from "@/types/db";

import { StatusPill } from "./status-pill";

export interface RosterTableProps {
  students: RosterStudent[];
  /** For rendering a student's carpool by name rather than by id. */
  carpools: Carpool[];
  onEdit: (student: RosterStudent) => void;
  onDelete: (student: RosterStudent) => Promise<void>;
  /** The row currently mid-delete, so its button can say "Removing…". */
  deletingId: string | null;
  selectedIds: Set<string>;
  onSelectionChange: (next: Set<string>) => void;
}

/**
 * The roster, one row per student. Classes are set in
 * `font-mono` chips -- CLAUDE.md calls this out by name as one of the few things
 * in the app meant to line up in columns, the same rule a CSV row number or a
 * device id follows.
 *
 * Delete has no undo anywhere in the app, so it is the one action here with
 * its own inline confirmation rather than firing on the first click.
 *
 * The leftmost checkbox column feeds `selectedIds`, owned by the parent
 * (`RosterManager`), which drives the bulk "Remove N from roster" flow -- this
 * component only knows how to toggle one row or a shift-click range, and a
 * header checkbox for "select all currently visible". Range select is a
 * shift-click between the last row clicked and the one just clicked, the
 * practical, accessible equivalent of drag-selecting a section of a table;
 * true mouse-drag rubber-band selection is out of scope.
 */
export function RosterTable({
  students,
  carpools,
  onEdit,
  onDelete,
  deletingId,
  selectedIds,
  onSelectionChange,
}: RosterTableProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const lastClickedIndexRef = useRef<number | null>(null);
  const carpoolNameById = new Map(
    carpools.map((carpool) => [carpool.id, carpool.name]),
  );

  const allSelected =
    students.length > 0 &&
    students.every((student) => selectedIds.has(student.id));

  function toggleAll() {
    onSelectionChange(
      allSelected ? new Set() : new Set(students.map((student) => student.id)),
    );
  }

  function toggleRow(index: number, id: string, shiftKey: boolean) {
    const next = new Set(selectedIds);

    if (shiftKey && lastClickedIndexRef.current !== null) {
      const [start, end] = [lastClickedIndexRef.current, index].sort(
        (a, b) => a - b,
      );
      for (let i = start; i <= end; i++) {
        next.add(students[i].id);
      }
    } else if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }

    lastClickedIndexRef.current = index;
    onSelectionChange(next);
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-curb-200 bg-white shadow-card">
      <table className="w-full min-w-[760px] border-collapse text-left">
        <thead>
          <tr className="border-b border-curb-200 bg-curb-50 text-xs uppercase tracking-eyebrow text-curb-500">
            <th className="w-10 px-4 py-3">
              <input
                type="checkbox"
                className="focus-ring h-4 w-4 rounded border-curb-400"
                checked={allSelected}
                onChange={toggleAll}
                aria-label="Select every student"
              />
            </th>
            <th className="px-4 py-3 font-semibold">Name</th>
            <th className="px-4 py-3 font-semibold">Aliases</th>
            <th className="px-4 py-3 font-semibold">Class</th>
            <th className="px-4 py-3 font-semibold">Carpool</th>
            <th className="px-4 py-3 font-semibold">Status</th>
            <th className="px-4 py-3 font-semibold">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {students.map((student, index) => {
            const isConfirming = confirmingId === student.id;
            const isDeleting = deletingId === student.id;
            const isSelected = selectedIds.has(student.id);
            const parentNames = [student.parent1_name, student.parent2_name]
              .filter((name): name is string => name !== null && name !== "")
              .join(" · ");

            return (
              <tr
                key={student.id}
                className={cn(
                  "border-b border-curb-100 last:border-b-0 hover:bg-curb-50",
                  isSelected && "bg-marigold-50",
                )}
              >
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    className="focus-ring h-4 w-4 rounded border-curb-400"
                    checked={isSelected}
                    onChange={(event) =>
                      toggleRow(
                        index,
                        student.id,
                        (event.nativeEvent as MouseEvent).shiftKey,
                      )
                    }
                    aria-label={`Select ${student.first_name} ${student.last_name}`}
                  />
                </td>
                <td className="px-4 py-3 font-medium text-curb-900">
                  {student.first_name} {student.last_name}
                  {parentNames !== "" && (
                    <span className="block text-xs font-normal text-curb-500">
                      {parentNames}
                    </span>
                  )}
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
                <td className="px-4 py-3">
                  {student.class_groups.length > 0 ? (
                    <ul className="flex flex-col items-start gap-1">
                      {student.class_groups.map((name) => (
                        <li
                          key={name}
                          className="whitespace-nowrap rounded-full border border-curb-200 bg-curb-50 px-2.5 py-0.5 font-mono text-xs text-curb-700"
                        >
                          {name}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-curb-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-curb-700">
                  {student.carpool_id ? (
                    (carpoolNameById.get(student.carpool_id) ?? (
                      <span className="text-curb-400">—</span>
                    ))
                  ) : (
                    <span className="text-curb-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <StatusPill status={student.status} />
                </td>
                <td
                  className={cn("px-4 py-3", isConfirming && "min-w-[220px]")}
                >
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
