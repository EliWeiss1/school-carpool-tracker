"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { cn } from "@/lib/cn";
import {
  type ColumnGuess,
  type DetectedLayout,
  HEADER_SEARCH_ROWS,
  columnLetter,
  layoutProblems,
} from "@/lib/import/detect-columns";
import {
  type ColumnAssignment,
  FIELD_LABELS,
  FIELD_ORDER,
} from "@/lib/import/fields";
import { type NameOrder, splitFullName } from "@/lib/import/split-name";

export interface ImportMappingProps {
  layout: DetectedLayout;
  rowCount: number;
  /** Whether every guess was confident, so the cards can start folded away. */
  confident: boolean;
  onAssign: (column: number, field: ColumnAssignment) => void;
  onNameOrder: (order: NameOrder) => void;
  onHeaderRow: (row: number) => void;
  onBack: () => void;
  onContinue: () => void;
}

function ColumnCard({
  column,
  onAssign,
}: {
  column: ColumnGuess;
  onAssign: (field: ColumnAssignment) => void;
}) {
  const selectId = useId();
  const ignored = column.field === "ignore";
  const unsure = column.confidence === "low";

  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-2xl border bg-white p-4 shadow-card",
        unsure
          ? "border-marigold-500 ring-2 ring-marigold-400/40"
          : "border-curb-200",
        ignored && !unsure && "bg-curb-50",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 break-words font-display text-lg font-bold leading-tight text-curb-900">
          <span className="mr-2 font-mono text-sm font-normal text-curb-500">
            {columnLetter(column.index)}
          </span>
          {column.heading}
        </p>
        <span
          className={cn(
            "shrink-0 rounded-xl px-2 py-1 text-sm font-semibold",
            unsure ? "bg-marigold-50 text-marigold-600" : "text-curb-500",
          )}
        >
          {unsure
            ? "Check this"
            : column.confidence === "high"
              ? "Matched"
              : ignored
                ? "Not used"
                : "Your choice"}
        </span>
      </div>

      <ul className="flex min-h-12 flex-col gap-1 text-sm text-curb-600">
        {column.samples.length > 0 ? (
          column.samples.map((sample, index) => (
            <li key={`${index}-${sample}`} className="truncate">
              {sample}
            </li>
          ))
        ) : (
          <li className="text-curb-400">Empty column</li>
        )}
      </ul>

      <div className="flex flex-col gap-1">
        <label htmlFor={selectId} className="text-sm text-curb-500">
          This column is
        </label>
        <select
          id={selectId}
          value={column.field}
          onChange={(event) => onAssign(event.target.value as ColumnAssignment)}
          className="focus-ring min-h-tap w-full rounded-xl border border-curb-300 bg-white px-3 font-sans text-base text-curb-900 hover:border-curb-400"
        >
          {FIELD_ORDER.map((field) => (
            <option key={field} value={field}>
              {FIELD_LABELS[field]}
            </option>
          ))}
          <option value="ignore">{FIELD_LABELS.ignore}</option>
        </select>
      </div>
    </li>
  );
}

/**
 * Step 2: every column, what we think it is, and a dropdown to say otherwise.
 * Real sample values sit on each card, because "is this the surname column?"
 * is answered by looking at "Cohen, Levy, Katz", not at a heading.
 */
export function ImportMapping({
  layout,
  rowCount,
  confident,
  onAssign,
  onNameOrder,
  onHeaderRow,
  onBack,
  onContinue,
}: ImportMappingProps) {
  const [expanded, setExpanded] = useState(!confident);
  const headerSelectId = useId();
  const problems = layoutProblems(layout.assignments);

  const fullNameSamples =
    layout.columns.find((c) => c.field === "full_name")?.samples ?? [];
  // Only ask about order when names come from one column and some sample has
  // no comma to settle it ("Cohen, Miriam" is always last name first).
  const usesFullName =
    layout.assignments.includes("full_name") &&
    !(
      layout.assignments.includes("first_name") &&
      layout.assignments.includes("last_name")
    ) &&
    fullNameSamples.some((sample) => !sample.includes(","));
  const fullNameSample = usesFullName
    ? fullNameSamples.find((sample) => !sample.includes(","))
    : undefined;
  const splitExample = fullNameSample
    ? splitFullName(fullNameSample, layout.nameOrder)
    : null;

  const used = layout.columns.filter((c) => c.field !== "ignore");
  const unused = layout.columns.filter(
    (c) => c.field === "ignore" && c.samples.length > 0,
  );
  const headerRowChoices = Math.min(rowCount, HEADER_SEARCH_ROWS);

  return (
    <div className="flex flex-col gap-6">
      {problems.length > 0 && <ErrorBanner message={problems.join(" ")} />}

      {confident && !expanded ? (
        <div className="flex flex-col gap-4 rounded-2xl border border-curb-200 bg-curb-50 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-display text-xl font-bold text-curb-900">
                We recognised every column we need.
              </p>
              {unused.length > 0 && (
                <p className="text-curb-600">
                  Not imported: {unused.map((c) => c.heading).join(", ")}.
                </p>
              )}
            </div>
            <Button variant="secondary" onClick={() => setExpanded(true)}>
              Change columns
            </Button>
          </div>
          <ul className="flex flex-wrap gap-2">
            {used.map((c) => (
              <li
                key={c.index}
                className="rounded-xl border border-curb-200 bg-white px-3 py-1 text-sm"
              >
                <span className="text-curb-600">{c.heading}</span>
                <span className="text-curb-400"> is </span>
                <span className="font-semibold text-curb-900">
                  {FIELD_LABELS[c.field]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor={headerSelectId} className="text-sm text-curb-500">
                Column headings are on
              </label>
              <select
                id={headerSelectId}
                value={layout.headerRowIndex}
                onChange={(event) => onHeaderRow(Number(event.target.value))}
                className="focus-ring min-h-tap rounded-xl border border-curb-300 bg-white px-3 text-base text-curb-900 hover:border-curb-400"
              >
                {Array.from({ length: headerRowChoices }, (_, row) => (
                  <option key={row} value={row}>
                    Row {row + 1}
                  </option>
                ))}
                <option value={-1}>No heading row</option>
              </select>
            </div>
            <p className="pb-3 text-sm text-curb-600">
              Set each column below. Anything set to &quot;Don&apos;t
              import&quot; is left out.
            </p>
          </div>

          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {layout.columns.map((column) => (
              <ColumnCard
                key={column.index}
                column={column}
                onAssign={(field) => onAssign(column.index, field)}
              />
            ))}
          </ul>
        </>
      )}

      {usesFullName && (
        <fieldset className="flex flex-col gap-3 rounded-2xl border border-curb-200 bg-white p-6 shadow-card">
          <legend className="px-1 font-display text-lg font-semibold text-curb-900">
            How are the full names written?
          </legend>
          <div className="flex flex-wrap gap-3">
            {(
              [
                ["first-last", "First name first (Miriam Cohen)"],
                ["last-first", "Last name first (Cohen Miriam)"],
              ] as const
            ).map(([order, label]) => (
              <label
                key={order}
                className={cn(
                  "flex min-h-tap cursor-pointer items-center gap-3 rounded-xl border px-4 focus-within:ring-[3px] focus-within:ring-marigold-500 hover:border-curb-400",
                  layout.nameOrder === order
                    ? "border-marigold-500 bg-marigold-50"
                    : "border-curb-300",
                )}
              >
                <input
                  type="radio"
                  name="name-order"
                  value={order}
                  checked={layout.nameOrder === order}
                  onChange={() => onNameOrder(order)}
                  className="h-5 w-5 accent-marigold-500"
                />
                <span className="text-curb-900">{label}</span>
              </label>
            ))}
          </div>
          {splitExample && fullNameSample && (
            <p className="text-sm text-curb-600">
              &quot;{fullNameSample}&quot; becomes first name{" "}
              <strong className="text-curb-900">
                {splitExample.first_name}
              </strong>
              , last name{" "}
              <strong className="text-curb-900">
                {splitExample.last_name}
              </strong>
              . Names with a comma (&quot;Cohen, Miriam&quot;) are always read
              as last name first.
            </p>
          )}
        </fieldset>
      )}

      <div className="flex flex-wrap justify-between gap-3">
        <Button variant="quiet" onClick={onBack}>
          Choose a different file
        </Button>
        <Button
          variant="primary"
          onClick={onContinue}
          disabled={problems.length > 0}
        >
          Continue to review
        </Button>
      </div>
    </div>
  );
}
