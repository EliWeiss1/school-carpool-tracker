"use client";

import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { AnnounceResults } from "@/lib/announce-reducer";

/**
 * The tap targets for a `clear` or `ambiguous` resolve-name result.
 *
 * Nothing here ever fires on its own — CLAUDE.md's one non-negotiable is that
 * a transcription never auto-writes a status change, so `clear` only earns the
 * first button a `primary` look; every candidate, `clear` or not, still needs
 * an actual tap.
 */
export function CandidateList({
  results,
  confirmingId,
  onConfirm,
}: {
  results: AnnounceResults;
  confirmingId: string | null;
  onConfirm: (candidate: AnnounceResults["candidates"][number]) => void;
}) {
  const busy = confirmingId !== null;

  return (
    <div className="flex flex-col gap-3">
      <p className="px-1 text-sm text-curb-600">
        Heard <span className="font-semibold text-curb-900">&ldquo;{results.transcript}&rdquo;</span>
        {results.tier === "ambiguous" && " — more than one close match:"}
      </p>

      <ul className="flex flex-col gap-3">
        {results.candidates.map((candidate, index) => {
          const preHighlight = results.tier === "clear" && index === 0;
          const isThisOne = confirmingId === candidate.student.id;
          const alreadyArrived = candidate.student.status === "arrived";

          return (
            <li key={candidate.student.id}>
              <Button
                type="button"
                size="candidate"
                fullWidth
                variant={preHighlight ? "primary" : "secondary"}
                disabled={busy}
                onClick={() => onConfirm(candidate)}
              >
                {/* Button centers its content; this inner block reclaims a
                    left-aligned, two-line layout without fighting Button's
                    own alignment classes. */}
                <span className="flex w-full flex-col items-start gap-1 text-left">
                  <span className="flex w-full items-baseline justify-between gap-3">
                    <span className="truncate font-display text-2xl font-bold tracking-display">
                      {candidate.student.first_name} {candidate.student.last_name}
                    </span>
                    {alreadyArrived && (
                      <span className="shrink-0 rounded-full bg-arrived-soft px-2 py-0.5 font-mono text-[0.6875rem] uppercase tracking-eyebrow text-arrived-deep">
                        Arrived
                      </span>
                    )}
                  </span>

                  <span
                    className={cn(
                      "font-mono text-xs uppercase tracking-eyebrow",
                      preHighlight ? "text-curb-800/70" : "text-curb-500",
                    )}
                  >
                    {[candidate.student.grade, candidate.student.class_group]
                      .filter(Boolean)
                      .join(" · ") || "No grade on file"}
                    {isThisOne && " — Confirming…"}
                  </span>
                </span>
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
