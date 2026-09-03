"use client";

import { type ChangeEvent, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { adminApi } from "@/lib/admin-api";
import { ApiError } from "@/lib/api";
import { type CsvImportReport, parseRosterCsv } from "@/lib/csv-import";
import type { UsePinSession } from "@/lib/use-pin-session";

export interface CsvImportPanelProps {
  session: UsePinSession;
  /** Called after a successful import so the roster table above can refresh. */
  onImported: () => void;
}

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

/**
 * CSV import for initial roster setup.
 *
 * Nothing is written until a person has seen the validation report and
 * pressed Import: `parseRosterCsv` runs entirely in the browser, and the
 * report is the only thing rendered until then. Row numbers use `font-mono`
 * throughout, matching the roster table's grade/class columns and the rest
 * of the app's rule that anything meant to line up in columns gets the mono
 * face.
 */
export function CsvImportPanel({ session, onImported }: CsvImportPanelProps) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [report, setReport] = useState<CsvImportReport | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportError(null);
    setImportedCount(null);
    setFileName(file.name);
    const text = await file.text();
    setReport(parseRosterCsv(text));
  }

  function reset() {
    setFileName(null);
    setReport(null);
    setImportError(null);
    setImportedCount(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function confirmImport() {
    if (!report || report.toImport.length === 0) return;

    setImporting(true);
    setImportError(null);
    try {
      const result = await adminApi.importRoster({
        ...requireCredentials(session),
        students: report.toImport,
      });
      setImportedCount(result.created);
      setReport(null);
      onImported();
    } catch (error: unknown) {
      setImportError(
        error instanceof ApiError
          ? error.message
          : "The import did not go through. Try again.",
      );
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-curb-200 bg-white p-6 shadow-card">
      <div>
        <h2 className="font-display text-2xl font-bold text-curb-900">
          Import a roster CSV
        </h2>
        <p className="mt-1 text-curb-600">
          Columns can be in any order. Required: first name, last name.
          Optional: aliases (comma or semicolon separated), grade, class.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label
          htmlFor={inputId}
          className="focus-ring inline-flex min-h-tap cursor-pointer items-center justify-center rounded-xl border border-curb-300 bg-white px-6 font-display font-semibold text-curb-900 shadow-card transition-[transform,background-color,border-color] duration-150 ease-spring hover:border-curb-400 hover:bg-curb-50 active:scale-[0.98]"
        >
          Choose file
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => void handleFile(event)}
          className="sr-only"
        />
        {fileName && <span className="text-sm text-curb-600">{fileName}</span>}
        {(report || importedCount !== null) && (
          <Button variant="quiet" size="sm" onClick={reset}>
            Start over
          </Button>
        )}
      </div>

      {importedCount !== null && (
        <ErrorBanner
          tone="warning"
          message={`Imported ${importedCount} student${importedCount === 1 ? "" : "s"}.`}
        />
      )}

      {report && (
        <div className="flex flex-col gap-4">
          {report.headerErrors.length > 0 ? (
            <ErrorBanner
              message={report.headerErrors.join(" ")}
            />
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-3 rounded-xl border border-curb-200 bg-curb-50 p-4 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-curb-500">Rows in file</dt>
                  <dd className="font-mono text-lg text-curb-900">
                    {report.totalDataRows}
                  </dd>
                </div>
                <div>
                  <dt className="text-curb-500">Will import</dt>
                  <dd className="font-mono text-lg text-arrived-deep">
                    {report.toImport.length}
                  </dd>
                </div>
                <div>
                  <dt className="text-curb-500">Skipped (errors)</dt>
                  <dd className="font-mono text-lg text-waiting-deep">
                    {report.errors.length}
                  </dd>
                </div>
                <div>
                  <dt className="text-curb-500">Blank rows</dt>
                  <dd className="font-mono text-lg text-curb-600">
                    {report.blankRowsSkipped}
                  </dd>
                </div>
              </dl>

              {report.errors.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-waiting-border">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="bg-waiting-soft text-waiting-deep">
                        <th className="px-3 py-2 font-semibold">Row</th>
                        <th className="px-3 py-2 font-semibold">Problem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.errors.map((rowError) => (
                        <tr
                          key={rowError.rowNumber}
                          className="border-t border-waiting-border/60"
                        >
                          <td className="px-3 py-2 font-mono text-curb-700">
                            {rowError.rowNumber}
                          </td>
                          <td className="px-3 py-2 text-curb-700">
                            {rowError.message}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {report.toImport.length > 0 && (
                <div className="max-h-64 overflow-y-auto rounded-xl border border-curb-200">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead className="sticky top-0 bg-curb-50">
                      <tr className="text-curb-500">
                        <th className="px-3 py-2 font-semibold">Name</th>
                        <th className="px-3 py-2 font-semibold">Aliases</th>
                        <th className="px-3 py-2 font-semibold">Grade</th>
                        <th className="px-3 py-2 font-semibold">Class</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.toImport.map((row, index) => (
                        <tr
                          key={`${row.first_name}-${row.last_name}-${index}`}
                          className="border-t border-curb-100"
                        >
                          <td className="px-3 py-2 text-curb-900">
                            {row.first_name} {row.last_name}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-curb-600">
                            {row.aliases.join(", ") || "—"}
                          </td>
                          <td className="px-3 py-2 font-mono text-curb-700">
                            {row.grade ?? "—"}
                          </td>
                          <td className="px-3 py-2 font-mono text-curb-700">
                            {row.class_group ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {importError && <ErrorBanner message={importError} />}

              <div className="flex justify-end">
                <Button
                  variant="primary"
                  size="md"
                  disabled={report.toImport.length === 0 || importing}
                  onClick={() => void confirmImport()}
                >
                  {importing
                    ? "Importing…"
                    : `Import ${report.toImport.length} student${report.toImport.length === 1 ? "" : "s"}`}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
