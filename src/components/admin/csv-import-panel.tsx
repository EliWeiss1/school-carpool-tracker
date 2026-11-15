"use client";

import { useMemo, useReducer, useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { LoadingState } from "@/components/ui/loading-state";
import { adminApi } from "@/lib/admin-api";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  type ImportStep,
  STEP_LABELS,
  STEP_ORDER,
  deriveReview,
  importFlowReducer,
  initialImportState,
  layoutIsConfident,
} from "@/lib/import/import-flow";
import { readFileToGrid, textToGrid } from "@/lib/import/read-source";
import type { UsePinSession } from "@/lib/use-pin-session";

import { ImportMapping } from "./import-mapping";
import { ImportPreview } from "./import-preview";
import { ImportSource } from "./import-source";

export interface CsvImportPanelProps {
  session: UsePinSession;
  /** Called after a successful import (or undo) so the roster refreshes. */
  onImported: () => void;
  /** The live class names, so the preview can say which classes are new. */
  classNames?: readonly string[];
  /** The current roster, so a re-imported file skips who is already there. */
  rosterNames?: readonly { first_name: string; last_name: string }[];
  /** Existing carpool names, so the preview can say which carpools are new. */
  carpoolNames?: readonly string[];
  /**
   * False while the class list or roster is still loading. Until then an
   * empty class list would make every class look new, so review waits.
   */
  classesReady?: boolean;
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

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

/** Where the admin is, and a way back to any step already done. */
function StepTracker({
  step,
  reachable,
  onGoTo,
}: {
  step: ImportStep;
  reachable: (step: ImportStep) => boolean;
  onGoTo: (step: ImportStep) => void;
}) {
  const current = STEP_ORDER.indexOf(step);
  return (
    <ol className="flex flex-wrap gap-2" aria-label="Import steps">
      {STEP_ORDER.map((id, index) => {
        const isCurrent = id === step;
        const done = index < current;
        const canGo = !isCurrent && reachable(id);
        return (
          <li key={id}>
            <button
              type="button"
              disabled={!canGo}
              aria-current={isCurrent ? "step" : undefined}
              onClick={() => onGoTo(id)}
              className={cn(
                "focus-ring flex min-h-tap items-center gap-2 rounded-xl px-3 font-display font-semibold transition-[background-color] duration-150",
                isCurrent
                  ? "bg-marigold-500 text-curb-900"
                  : done
                    ? "text-curb-900 hover:bg-curb-100 active:bg-curb-200"
                    : "text-curb-400",
                !canGo && !isCurrent && "cursor-default",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-xl text-sm",
                  isCurrent ? "bg-curb-900 text-marigold-400" : "bg-curb-100",
                )}
              >
                {index + 1}
              </span>
              {id === "done" && step === "done" ? "Imported" : STEP_LABELS[id]}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Roster import for a school's first setup, or a new term.
 *
 * Choose -> Check columns -> Review -> Import. Nothing is written until the
 * admin presses Import on the review step; every step before that runs in the
 * browser. The state machine is `import-flow.ts`; this component only wires
 * it to the screen and the network.
 */
export function CsvImportPanel({
  session,
  onImported,
  classNames = [],
  rosterNames = [],
  carpoolNames = [],
  classesReady = true,
}: CsvImportPanelProps) {
  const [state, dispatch] = useReducer(importFlowReducer, initialImportState);
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [undone, setUndone] = useState(false);

  const review = useMemo(
    () =>
      deriveReview(state, {
        knownClassNames: classNames,
        rosterNames,
        carpoolNames,
      }),
    [state, classNames, rosterNames, carpoolNames],
  );

  async function loadFile(file: File) {
    const result = await readFileToGrid(file);
    if (result.ok) {
      dispatch({
        type: "sourceLoaded",
        label: file.name,
        source: result.source,
      });
    } else {
      dispatch({
        type: "sourceFailed",
        message: `${file.name}: ${result.message}`,
      });
    }
  }

  function loadPaste(text: string) {
    dispatch({
      type: "sourceLoaded",
      label: "Pasted cells",
      source: textToGrid(text),
    });
  }

  async function confirmImport() {
    if (!review || review.students.length === 0) return;
    dispatch({ type: "importStarted" });
    try {
      const result = await adminApi.importRoster({
        ...requireCredentials(session),
        students: review.students,
        createMissingClasses: review.report.newClasses.length > 0 || undefined,
      });
      setUndone(false);
      setUndoError(null);
      dispatch({
        type: "importSucceeded",
        result: {
          created: result.created,
          createdIds: result.students.map((student) => student.id),
          createdClasses: result.createdClasses ?? [],
          createdCarpools: review.carpools.filter((c) => c.isNew).length,
        },
      });
      onImported();
    } catch (error: unknown) {
      dispatch({
        type: "importFailed",
        message:
          error instanceof ApiError
            ? error.message
            : "The import did not go through. Try again.",
      });
    }
  }

  /** Removes exactly the students this import created, nothing else. */
  async function undoImport() {
    const ids = state.result?.createdIds ?? [];
    if (ids.length === 0) return;
    setUndoing(true);
    setUndoError(null);
    try {
      await adminApi.deleteStudents({
        ...requireCredentials(session),
        studentIds: ids,
      });
      setUndone(true);
      onImported();
    } catch (error: unknown) {
      setUndoError(
        error instanceof ApiError
          ? error.message
          : "The undo did not go through. Try again.",
      );
    } finally {
      setUndoing(false);
    }
  }

  function startOver() {
    setUndone(false);
    setUndoError(null);
    dispatch({ type: "reset" });
  }

  const reachable = (step: ImportStep) => {
    if (state.step === "done") return step === "choose";
    if (step === "choose") return true;
    if (step === "columns") return state.layout !== null;
    if (step === "review")
      return state.layout !== null && review?.report.headerErrors.length === 0;
    return false;
  };

  return (
    <section
      aria-labelledby="import-heading"
      className="flex flex-col gap-6 rounded-2xl border border-curb-200 bg-white p-6 shadow-card"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2
              id="import-heading"
              className="font-display text-2xl font-bold text-curb-900"
            >
              Import your roster
            </h2>
            <p className="mt-1 text-curb-600">
              Bring the student list you already have. Classes and carpools come
              in with it.
            </p>
          </div>
          {state.sourceLabel && state.step !== "choose" && (
            <p className="text-sm text-curb-600">
              From{" "}
              <span className="font-semibold text-curb-900">
                {state.sourceLabel}
              </span>
            </p>
          )}
        </div>
        <StepTracker
          step={state.step}
          reachable={reachable}
          onGoTo={(step) =>
            step === "choose" && state.step === "done"
              ? startOver()
              : dispatch({ type: "goTo", step })
          }
        />
        {state.sourceNote &&
          state.step !== "choose" &&
          state.step !== "done" && (
            <p className="text-sm text-curb-600">{state.sourceNote}</p>
          )}
      </div>

      {state.step === "choose" && (
        <ImportSource
          classNames={classNames}
          error={state.sourceError}
          errorLabel={null}
          onFile={(file) => void loadFile(file)}
          onPaste={loadPaste}
        />
      )}

      {state.step === "columns" && state.layout && (
        <ImportMapping
          // Remount on a new source so the folded/unfolded state starts fresh.
          key={state.sourceLabel ?? "source"}
          layout={state.layout}
          rowCount={state.grid.length}
          confident={layoutIsConfident(state.layout)}
          onAssign={(column, field) =>
            dispatch({ type: "assign", column, field })
          }
          onNameOrder={(order) => dispatch({ type: "setNameOrder", order })}
          onHeaderRow={(row) => dispatch({ type: "setHeaderRow", row })}
          onBack={() => dispatch({ type: "goTo", step: "choose" })}
          onContinue={() => dispatch({ type: "goTo", step: "review" })}
        />
      )}

      {state.step === "review" && !classesReady && (
        <LoadingState label="Loading your classes and roster…" />
      )}

      {state.step === "review" && classesReady && review && (
        <ImportPreview
          review={review}
          importing={state.importing}
          importError={state.importError}
          onToggleSuggestion={(id) =>
            dispatch({
              type: "toggleSuggestion",
              id,
              recommendedIds: review.suggestions
                .filter((s) => s.recommended)
                .map((s) => s.id),
            })
          }
          onSetAllSuggestions={(ids) =>
            dispatch({ type: "setAllSuggestions", ids })
          }
          onBack={() => dispatch({ type: "goTo", step: "columns" })}
          onImport={() => void confirmImport()}
        />
      )}

      {state.step === "done" && state.result && (
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-curb-200 bg-curb-50 p-6">
            <p className="font-display text-2xl font-bold text-curb-900">
              {undone
                ? `Undone. ${plural(state.result.created, "student")} removed again.`
                : `Imported ${plural(state.result.created, "student")}.`}
            </p>
            {!undone && (
              <p className="mt-1 text-curb-600">
                {[
                  state.result.createdClasses.length > 0 &&
                    `${plural(state.result.createdClasses.length, "new class", "new classes")} created`,
                  state.result.createdCarpools > 0 &&
                    `${plural(state.result.createdCarpools, "new carpool")} set up`,
                ]
                  .filter(Boolean)
                  .join(", ") || "They're on the roster above."}
              </p>
            )}
            {undone && (
              <p className="mt-1 text-curb-600">
                Any classes and carpools the import created are still there.
                Remove them under Classes and Carpools if you don&apos;t need
                them.
              </p>
            )}
          </div>
          {undoError && <ErrorBanner message={undoError} />}
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={startOver}>
              Import another file
            </Button>
            {!undone && state.result.createdIds.length > 0 && (
              <Button
                variant="quiet"
                onClick={() => void undoImport()}
                disabled={undoing}
              >
                {undoing
                  ? "Undoing…"
                  : `Undo import (${plural(state.result.createdIds.length, "student")})`}
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
