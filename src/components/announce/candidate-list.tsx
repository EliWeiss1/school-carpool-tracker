"use client";

import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  candidateKey,
  candidateLabel,
  type AnnounceResults,
  type ResolveCandidateLike,
} from "@/lib/announce-reducer";

/**
 * The tap targets for a `clear` or `ambiguous` resolve-name result.
 *
 * Nothing here ever fires on its own — CLAUDE.md's one non-negotiable is that
 * a transcription never auto-writes a status change, so `clear` only earns the
 * first button a `primary` look; every candidate, `clear` or not, still needs
 * an actual tap.
 *
 * A candidate that is a carpool leads with the carpool's own name and lists
 * every member beneath it — the button still names an exact count
 * ("Confirm all 3 arrived") so nobody taps it assuming it means just one name.
 *
 * "Announce several" (`multiSelect`) is off by default, in which case a tap
 * confirms immediately, exactly as it always has. Turning it on makes a tap
 * check a candidate instead, and a single "Confirm N arrived" button below
 * the list does the actual write — deliberately a second, explicit action,
 * since two high-scoring candidates can mean "both are right" or "I'm not
 * sure which", and only a person can tell those apart.
 */
export function CandidateList({
  results,
  confirmingKey,
  multiSelect,
  selectedKeys,
  onConfirm,
  onToggleSelect,
  onConfirmSelected,
  onToggleMultiSelect,
}: {
  results: AnnounceResults;
  confirmingKey: string | null;
  multiSelect: boolean;
  selectedKeys: string[];
  onConfirm: (candidate: ResolveCandidateLike) => void;
  onToggleSelect: (key: string) => void;
  onConfirmSelected: () => void;
  onToggleMultiSelect: () => void;
}) {
  const busy = confirmingKey !== null;
  const showMultiSelectToggle = results.candidates.length > 1;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="text-sm text-curb-600">
          Heard <span className="font-semibold text-curb-900">&ldquo;{results.transcript}&rdquo;</span>
          {results.tier === "ambiguous" && " — more than one close match:"}
        </p>
        {showMultiSelectToggle && (
          <button
            type="button"
            onClick={onToggleMultiSelect}
            disabled={busy}
            className="focus-ring shrink-0 whitespace-nowrap font-mono text-xs uppercase tracking-eyebrow text-curb-500 underline decoration-curb-300 underline-offset-2 hover:text-curb-700"
          >
            {multiSelect ? "Announce one at a time" : "Announce several"}
          </button>
        )}
      </div>

      <ul className="flex flex-col gap-3">
        {results.candidates.map((candidate, index) => {
          const key = candidateKey(candidate);
          const preHighlight =
            !multiSelect && results.tier === "clear" && index === 0;
          const isThisOne = confirmingKey === key;
          const isSelected = selectedKeys.includes(key);
          const allArrived = candidate.students.every(
            (student) => student.status === "arrived",
          );
          const label = candidateLabel(candidate);
          const meta = candidate.carpool
            ? `${candidate.students.length} student${candidate.students.length === 1 ? "" : "s"}`
            : (candidate.students[0].class_group ?? "No class on file");

          return (
            <li key={key}>
              <Button
                type="button"
                size="candidate"
                fullWidth
                variant={
                  multiSelect
                    ? isSelected
                      ? "primary"
                      : "secondary"
                    : preHighlight
                      ? "primary"
                      : "secondary"
                }
                disabled={busy}
                aria-pressed={multiSelect ? isSelected : undefined}
                onClick={() =>
                  multiSelect ? onToggleSelect(key) : onConfirm(candidate)
                }
              >
                {/* Button centers its content; this inner block reclaims a
                    left-aligned, two-line layout without fighting Button's
                    own alignment classes. */}
                <span className="flex w-full flex-col items-start gap-1 text-left">
                  <span className="flex w-full items-baseline justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      {multiSelect && (
                        <span
                          aria-hidden="true"
                          className={cn(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2",
                            isSelected
                              ? "border-marigold-600 bg-marigold-500 text-ink"
                              : "border-curb-400 bg-white",
                          )}
                        >
                          {isSelected && "✓"}
                        </span>
                      )}
                      <span className="truncate font-display text-2xl font-bold tracking-display">
                        {label}
                      </span>
                    </span>
                    {allArrived && (
                      <span className="shrink-0 rounded-full bg-arrived-soft px-2 py-0.5 font-mono text-[0.6875rem] uppercase tracking-eyebrow text-arrived-deep">
                        Arrived
                      </span>
                    )}
                  </span>

                  {candidate.carpool && (
                    <span className="truncate text-sm text-curb-700">
                      {candidate.students
                        .map((s) => `${s.first_name} ${s.last_name}`)
                        .join(", ")}
                    </span>
                  )}

                  <span
                    className={cn(
                      "font-mono text-xs uppercase tracking-eyebrow",
                      preHighlight ? "text-curb-800/70" : "text-curb-500",
                    )}
                  >
                    {meta}
                    {isThisOne && " — Confirming…"}
                  </span>
                </span>
              </Button>
            </li>
          );
        })}
      </ul>

      {multiSelect && (
        <Button
          type="button"
          size="tap"
          fullWidth
          disabled={busy || selectedKeys.length === 0}
          onClick={onConfirmSelected}
        >
          {selectedKeys.length === 0
            ? "Select who arrived"
            : `Confirm ${selectedKeys.reduce(
                (count, key) =>
                  count +
                  (results.candidates.find((c) => candidateKey(c) === key)
                    ?.students.length ?? 0),
                0,
              )} arrived`}
        </Button>
      )}
    </div>
  );
}
