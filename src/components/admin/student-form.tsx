"use client";

import { type FormEvent, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import type { RosterStudent, StudentFields } from "@/lib/admin-api";
import { cn } from "@/lib/cn";
import { toggleClass } from "@/lib/class-selection";
import { NO_CARPOOL, buildStudentFields } from "@/lib/student-form-fields";
import type { Carpool } from "@/types/db";

const INPUT_CLASS =
  "focus-ring min-h-tap w-full rounded-xl border border-curb-300 bg-curb-50 px-3.5 text-curb-900 transition-colors duration-150 placeholder:text-curb-400 hover:border-curb-400";

const LABEL_CLASS = "text-sm font-semibold text-curb-700";

export interface StudentFormProps {
  /** Omitted for "add a student"; a row for "edit this one". */
  student?: RosterStudent;
  /** For the carpool picker. Empty is fine -- the field just has one option, "None". */
  carpools: Carpool[];
  /** The admin-editable class list, in display order. */
  classGroups: string[];
  onCancel: () => void;
  onSubmit: (fields: StudentFields) => Promise<void>;
  submitting: boolean;
  error: string | null;
}

/**
 * The one form that both adds and edits a student. It never renders a status
 * control: `StudentFields` has no room for one, because a roster edit is not
 * how a child gets marked arrived (see roster-write.ts for why).
 */
export function StudentForm({
  student,
  carpools,
  classGroups,
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
  const [selectedClasses, setSelectedClasses] = useState<string[]>(
    student?.class_groups ?? [],
  );
  const [carpoolId, setCarpoolId] = useState(student?.carpool_id ?? NO_CARPOOL);
  const [parent1Name, setParent1Name] = useState(student?.parent1_name ?? "");
  const [parent2Name, setParent2Name] = useState(student?.parent2_name ?? "");
  const formId = useId();

  async function submit(event: FormEvent) {
    event.preventDefault();
    // On an edit, classes are only sent if the admin changed them -- see
    // buildStudentFields for why re-sending an untouched set loses data.
    await onSubmit(
      buildStudentFields(
        {
          firstName,
          lastName,
          aliasesText,
          selectedClasses,
          carpoolId,
          parent1Name,
          parent2Name,
        },
        student,
      ),
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-4 rounded-2xl border border-marigold-300 bg-marigold-50 p-6 shadow-card"
    >
      <h3 className="font-display text-lg font-bold text-curb-900">
        {student
          ? `Edit ${student.first_name} ${student.last_name}`
          : "Add a student"}
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

        <fieldset className="flex min-w-0 flex-col gap-2 sm:col-span-2">
          <legend className={LABEL_CLASS}>
            Classes: tick every class this student is in
          </legend>
          {classGroups.length === 0 ? (
            <p className="text-sm text-curb-500">
              No classes yet. Add one under Classes below, then tick it here.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {classGroups.map((name) => {
                const checked = selectedClasses.includes(name);
                return (
                  <li key={name}>
                    <label className="relative block cursor-pointer">
                      <input
                        type="checkbox"
                        className="peer sr-only"
                        checked={checked}
                        onChange={(event) =>
                          setSelectedClasses((current) =>
                            toggleClass(
                              current,
                              name,
                              event.target.checked,
                              classGroups,
                            ),
                          )
                        }
                      />
                      <span
                        className={cn(
                          "flex min-h-tap items-center gap-2 rounded-xl border px-3.5 font-mono text-sm text-curb-700 transition-[transform,background-color,border-color] duration-150 ease-spring",
                          "hover:border-curb-400 hover:bg-curb-50 active:scale-[0.98]",
                          "peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-marigold-500",
                          checked
                            ? "border-marigold-500 bg-white font-semibold text-curb-900 shadow-card hover:border-marigold-600 hover:bg-marigold-50"
                            : "border-curb-300 bg-curb-50",
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 text-xs leading-none",
                            checked
                              ? "border-marigold-500 bg-marigold-500 text-curb-900"
                              : "border-curb-400 bg-white text-transparent",
                          )}
                        >
                          &#10003;
                        </span>
                        {name}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-xs text-curb-500">
            Leave all unticked if the student has no class yet.
          </p>
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <label className={LABEL_CLASS} htmlFor={`${formId}-parent1`}>
            Parent 1 name
          </label>
          <input
            id={`${formId}-parent1`}
            className={INPUT_CLASS}
            value={parent1Name}
            onChange={(event) => setParent1Name(event.target.value)}
            placeholder="Optional"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={LABEL_CLASS} htmlFor={`${formId}-parent2`}>
            Parent 2 name
          </label>
          <input
            id={`${formId}-parent2`}
            className={INPUT_CLASS}
            value={parent2Name}
            onChange={(event) => setParent2Name(event.target.value)}
            placeholder="Optional"
          />
          <p className="text-xs text-curb-500">
            For your own reference, and so saying a parent&apos;s name at pickup
            announces this child too.
          </p>
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
        <Button
          variant="quiet"
          size="md"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="md" disabled={submitting}>
          {submitting ? "Saving…" : student ? "Save changes" : "Add student"}
        </Button>
      </div>
    </form>
  );
}
