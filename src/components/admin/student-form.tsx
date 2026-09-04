"use client";

import { type FormEvent, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import type { StudentFields } from "@/lib/admin-api";
import { CLASS_GROUPS } from "@/lib/classes";
import { cn } from "@/lib/cn";
import type { Carpool, Student } from "@/types/db";

const INPUT_CLASS =
  "focus-ring min-h-tap w-full rounded-xl border border-curb-300 bg-curb-50 px-3.5 text-curb-900 transition-colors duration-150 placeholder:text-curb-400 hover:border-curb-400";

const LABEL_CLASS = "text-sm font-semibold text-curb-700";

/** Splits on comma or semicolon, same rule csv-import.ts uses for the aliases column. */
function parseAliasesInput(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

export interface StudentFormProps {
  /** Omitted for "add a student"; a row for "edit this one". */
  student?: Student;
  /** For the carpool picker. Empty is fine -- the field just has one option, "None". */
  carpools: Carpool[];
  onCancel: () => void;
  onSubmit: (fields: StudentFields) => Promise<void>;
  submitting: boolean;
  error: string | null;
}

const NO_CARPOOL = "";

/**
 * The one form that both adds and edits a student. It never renders a status
 * control: `StudentFields` has no room for one, because a roster edit is not
 * how a child gets marked arrived (see roster-write.ts for why).
 */
export function StudentForm({
  student,
  carpools,
  onCancel,
  onSubmit,
  submitting,
  error,
}: StudentFormProps) {
  const [firstName, setFirstName] = useState(student?.first_name ?? "");
  const [lastName, setLastName] = useState(student?.last_name ?? "");
  const [aliasesText, setAliasesText] = useState(
    (student?.aliases ?? []).join(", "),
  );
  const [classGroup, setClassGroup] = useState(student?.class_group ?? "");
  const [carpoolId, setCarpoolId] = useState(student?.carpool_id ?? NO_CARPOOL);
  const formId = useId();

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onSubmit({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      aliases: parseAliasesInput(aliasesText),
      class_group: classGroup.trim() === "" ? null : classGroup.trim(),
      carpool_id: carpoolId === NO_CARPOOL ? null : carpoolId,
    });
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-4 rounded-2xl border border-marigold-300 bg-marigold-50 p-6 shadow-card"
    >
      <h3 className="font-display text-lg font-bold text-curb-900">
        {student ? `Edit ${student.first_name} ${student.last_name}` : "Add a student"}
      </h3>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label className={LABEL_CLASS} htmlFor={`${formId}-first`}>
            First name
          </label>
          <input
            id={`${formId}-first`}
            className={INPUT_CLASS}
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            required
            autoFocus
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={LABEL_CLASS} htmlFor={`${formId}-last`}>
            Last name
          </label>
          <input
            id={`${formId}-last`}
            className={INPUT_CLASS}
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            required
          />
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label className={LABEL_CLASS} htmlFor={`${formId}-aliases`}>
            Aliases
          </label>
          <input
            id={`${formId}-aliases`}
            className={cn(INPUT_CLASS, "font-mono text-sm")}
            value={aliasesText}
            onChange={(event) => setAliasesText(event.target.value)}
            placeholder="Kohen, Cohn"
          />
          <p className="text-xs text-curb-500">
            Other spellings the matcher should recognise. Separate with commas.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={LABEL_CLASS} htmlFor={`${formId}-class`}>
            Class
          </label>
          <select
            id={`${formId}-class`}
            className={cn(INPUT_CLASS, "font-mono")}
            value={classGroup}
            onChange={(event) => setClassGroup(event.target.value)}
          >
            <option value="">No class</option>
            {CLASS_GROUPS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label className={LABEL_CLASS} htmlFor={`${formId}-carpool`}>
            Carpool
          </label>
          <select
            id={`${formId}-carpool`}
            className={INPUT_CLASS}
            value={carpoolId}
            onChange={(event) => setCarpoolId(event.target.value)}
          >
            <option value={NO_CARPOOL}>None</option>
            {carpools.map((carpool) => (
              <option key={carpool.id} value={carpool.id}>
                {carpool.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-curb-500">
            Announcing this carpool, or any of its other members, marks this
            child arrived too. Set up carpools below.
          </p>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="flex justify-end gap-2">
        <Button variant="quiet" size="md" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="md" disabled={submitting}>
          {submitting ? "Saving…" : student ? "Save changes" : "Add student"}
        </Button>
      </div>
    </form>
  );
}
