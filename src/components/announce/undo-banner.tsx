"use client";

import { Button } from "@/components/ui";

/**
 * The ~2-minute undo affordance after a confirm. Reaches for the `arrived`
 * scale on purpose — this banner exists because a student *is* arrived right
 * now, so it should read like the tile that just turned green on /display —
 * and the undo action itself uses `danger`, the variant CLAUDE.md reserves for
 * sending a child back to waiting.
 *
 * The countdown text comes from `announce-undo.ts`; this component only
 * renders what it is given.
 */
export function UndoBanner({
  displayName,
  remainingLabel,
  pending,
  onUndo,
}: {
  displayName: string;
  /** Pre-formatted "m:ss", from `formatRemaining`. */
  remainingLabel: string;
  pending: boolean;
  onUndo: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-arrived-border bg-arrived-soft px-4 py-3 shadow-card">
      <div className="min-w-0">
        <p className="truncate font-display text-lg font-bold text-arrived-deep">
          {displayName} — arrived
        </p>
        <p className="font-mono text-xs uppercase tracking-eyebrow text-arrived">
          Undo window · {remainingLabel}
        </p>
      </div>
      <Button variant="danger" size="md" disabled={pending} onClick={onUndo}>
        {pending ? "Undoing…" : "Undo"}
      </Button>
    </div>
  );
}
