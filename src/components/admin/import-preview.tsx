"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { cn } from "@/lib/cn";
import type { ReviewModel } from "@/lib/import/import-flow";

export interface ImportPreviewProps {
  review: ReviewModel;
  importing: boolean;
  importError: string | null;
  onToggleSuggestion: (id: string) => void;
  onSetAllSuggestions: (ids: string[]) => void;
  onBack: () => void;
  onImport: () => void;
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * One outcome line ("98 students will be added"), opening to its list. A
 * `<details>` so it works with a keyboard and a screen reader for free.
 */
function Outcome({
  headline,
  detail,
  tone = "plain",
  children,
}: {
  headline: ReactNode;
  detail?: string;
  tone?: "plain" | "attention";
  children?: ReactNode;
}) {
  const body = (
    <span className="flex flex-col">
      <span className="font-display text-xl font-bold text-curb-900">
        {headline}
      </span>
      {detail && <span className="text-curb-600">{detail}</span>}
    </span>
  );
  const frame = cn(
    "rounded-2xl border bg-white shadow-card",
    tone === "attention" ? "border-marigold-500" : "border-curb-200",
  );

  if (!children) return <li className={cn(frame, "p-4")}>{body}</li>;
  return (
    <li className={frame}>
      <details className="group">
        <summary className="focus-ring flex min-h-tap cursor-pointer list-none items-center justify-between gap-4 rounded-2xl p-4 hover:bg-curb-50 active:bg-curb-100">
          {body}
          <span className="shrink-0 text-sm font-semibold text-curb-600 group-open:hidden">
            Show
          </span>
          <span className="hidden shrink-0 text-sm font-semibold text-curb-600 group-open:inline">
            Hide
          </span>
        </summary>
        <div className="max-h-72 overflow-y-auto border-t border-curb-100 px-4 py-3">
          {children}
        </div>
      </details>
    </li>
  );
}

/**
 * Step 3: what saving will do, as outcomes rather than statistics. Every line
 * opens to the exact list behind its number, so nothing is a surprise.
 */
export function ImportPreview({
  review,
  importing,
  importError,
  onToggleSuggestion,
  onSetAllSuggestions,
  onBack,
  onImport,
}: ImportPreviewProps) {
  const { report, suggestions, acceptedIds, students, carpools } = review;
  const newCarpools = carpools.filter((c) => c.isNew);
  const skippedNotes = [
    report.titleRowsSkipped > 0 &&
      `${plural(report.titleRowsSkipped, "row")} above the headings`,
    report.blankRowsSkipped > 0 && plural(report.blankRowsSkipped, "blank row"),
  ].filter(Boolean);

  if (report.headerErrors.length > 0) {
    return (
      <div className="flex flex-col gap-4">
        <ErrorBanner message={report.headerErrors.join(" ")} />
        <div>
          <Button variant="secondary" onClick={onBack}>
            Back to columns
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ul className="flex flex-col gap-3">
        <Outcome
          headline={`${plural(students.length, "student")} will be added`}
          detail={
            skippedNotes.length > 0
              ? `Skipped ${skippedNotes.join(" and ")}.`
              : undefined
          }
        >
          {students.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
                <thead>
                  <tr className="text-curb-500">
                    <th className="py-1 pr-3 font-semibold">Name</th>
                    <th className="py-1 pr-3 font-semibold">Class</th>
                    <th className="py-1 pr-3 font-semibold">Carpool</th>
                    <th className="py-1 font-semibold">Parents</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s, index) => (
                    <tr
                      key={`${report.toImportRows[index]}`}
                      className="border-t border-curb-100"
                    >
                      <td className="py-1 pr-3 text-curb-900">
                        {s.first_name} {s.last_name}
                      </td>
                      <td className="py-1 pr-3 font-mono text-curb-700">
                        {s.class_groups.join(", ") || "—"}
                      </td>
                      <td className="py-1 pr-3 text-curb-700">
                        {s.carpool ?? "—"}
                      </td>
                      <td className="py-1 text-curb-600">
                        {[s.parent1_name, s.parent2_name]
                          .filter(Boolean)
                          .join(", ") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Outcome>

        {report.newClasses.length > 0 && (
          <Outcome
            headline={`${plural(report.newClasses.length, "new class", "new classes")} will be created`}
            detail={
              report.newClasses.slice(0, 8).join(", ") +
              (report.newClasses.length > 8 ? "…" : "")
            }
          >
            <p className="text-sm text-curb-600">
              Each name below becomes a class. If two are the same class spelled
              differently, fix the spelling in your file and upload it again.
            </p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {report.newClasses.map((name) => (
                <li
                  key={name}
                  className="rounded-xl border border-curb-200 px-3 py-1 font-mono text-sm text-curb-800"
                >
                  {name}
                </li>
              ))}
            </ul>
          </Outcome>
        )}

        {carpools.length > 0 && (
          <Outcome
            headline={`${plural(carpools.length, "carpool")}${newCarpools.length > 0 && newCarpools.length < carpools.length ? ` (${newCarpools.length} new)` : newCarpools.length === carpools.length ? ", all new" : ", all existing"}`}
            detail="Everyone in a carpool is called together with one name."
          >
            <ul className="flex flex-col gap-1 text-sm">
              {carpools.map((carpool) => (
                <li
                  key={carpool.name}
                  className="flex justify-between gap-3 border-t border-curb-100 py-1 first:border-t-0"
                >
                  <span className="text-curb-900">{carpool.name}</span>
                  <span className="text-curb-600">
                    {plural(carpool.memberCount, "student")}
                    {carpool.isNew ? ", new" : ", already set up"}
                  </span>
                </li>
              ))}
            </ul>
          </Outcome>
        )}
      </ul>

      {suggestions.length > 0 && (
        <section
          aria-labelledby="sibling-heading"
          className="flex flex-col gap-4 rounded-2xl border border-curb-200 bg-white p-6 shadow-card"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3
                id="sibling-heading"
                className="font-display text-xl font-bold text-curb-900"
              >
                {suggestions.length === 1
                  ? "We found a family with more than one child"
                  : `We found ${suggestions.length} families with more than one child`}
              </h3>
              <p className="text-curb-600">
                Group siblings as a carpool and one name calls them all. Tick
                the ones that are really one family.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  onSetAllSuggestions(suggestions.map((s) => s.id))
                }
              >
                Tick all
              </Button>
              <Button
                variant="quiet"
                size="sm"
                onClick={() => onSetAllSuggestions([])}
              >
                Untick all
              </Button>
            </div>
          </div>

          <ul className="grid gap-3 sm:grid-cols-2">
            {suggestions.map((suggestion) => {
              const checked = acceptedIds.has(suggestion.id);
              return (
                <li key={suggestion.id}>
                  <label
                    className={cn(
                      "flex min-h-tap cursor-pointer items-start gap-3 rounded-xl border p-4 transition-[border-color,background-color] duration-150 focus-within:ring-[3px] focus-within:ring-marigold-500 hover:border-curb-400",
                      checked
                        ? "border-marigold-500 bg-marigold-50"
                        : "border-curb-200",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggleSuggestion(suggestion.id)}
                      className="mt-1 h-5 w-5 shrink-0 accent-marigold-500"
                    />
                    <span className="flex flex-col">
                      <span className="font-display font-semibold text-curb-900">
                        {suggestion.name}
                      </span>
                      <span className="text-sm text-curb-700">
                        {suggestion.memberIndexes
                          .map((i) => report.toImport[i]?.first_name)
                          .join(", ")}
                      </span>
                      <span className="text-sm text-curb-500">
                        {suggestion.basis === "parents"
                          ? "Same last name and parent"
                          : suggestion.basis === "parent-first-name"
                            ? "Same last name and parent's first name. Check they're one family"
                            : "Same last name only. Check they're one family"}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <ul className="flex flex-col gap-3">
        {report.alreadyOnRoster.length > 0 && (
          <Outcome
            headline={`${plural(report.alreadyOnRoster.length, "student")} already on your roster`}
            detail="They'll be skipped, so nobody is added twice."
          >
            <ul className="flex flex-col gap-1 text-sm text-curb-700">
              {report.alreadyOnRoster.map((match) => (
                <li key={match.rowNumber}>
                  <span className="mr-3 font-mono text-curb-500">
                    Row {match.rowNumber}
                  </span>
                  {match.name}
                </li>
              ))}
            </ul>
          </Outcome>
        )}

        {report.errors.length > 0 && (
          <Outcome
            tone="attention"
            headline={`${plural(report.errors.length, "row")} can't be imported`}
            detail="Import the rest now and add these by hand, or fix them in your file and upload it again."
          >
            <ul className="flex flex-col gap-1 text-sm text-curb-700">
              {report.errors.map((rowError) => (
                <li key={rowError.rowNumber}>
                  <span className="mr-3 font-mono text-curb-500">
                    Row {rowError.rowNumber}
                  </span>
                  {rowError.message}
                </li>
              ))}
            </ul>
          </Outcome>
        )}

        {report.unrecognizedHeaders.length > 0 && (
          <Outcome
            headline={`${plural(report.unrecognizedHeaders.length, "column")} not imported`}
            detail={report.unrecognizedHeaders.join(", ")}
          />
        )}
      </ul>

      {importError && <ErrorBanner message={importError} />}

      <div className="flex flex-wrap justify-between gap-3">
        <Button variant="quiet" onClick={onBack}>
          Back to columns
        </Button>
        <Button
          variant="primary"
          size="tap"
          onClick={onImport}
          disabled={students.length === 0 || importing}
        >
          {importing
            ? "Importing…"
            : `Import ${plural(students.length, "student")}`}
        </Button>
      </div>
    </div>
  );
}
