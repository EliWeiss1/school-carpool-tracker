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
 *
 * `compact` is the stacked layout the class drawer uses: its footer is only
 * 240-320px wide on a phone, too narrow for a name, a countdown and the Undo
 * button in one row. Stacked, nothing is ever truncated or wrapped mid-label,
 * at any width.
 */
export function UndoBanner({
  displayName,
  remainingLabel,
  pending,
  compact = false,
  onUndo,
}: {
  displayName: string;
  /** Pre-formatted "m:ss", from `formatRemaining`. */
  remainingLabel: string;
  pending: boolean;
  compact?: boolean;
  onUndo: () => void;
}) {
  if (compact) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-arrived-border bg-arrived-soft p-3 shadow-card">
        <p className="truncate font-display text-base font-bold text-arrived-deep">
          {displayName} — arrived
        </p>
        <Button
          variant="danger"
          size="md"
          fullWidth
          disabled={pending}
          onClick={onUndo}
        >
          {/* The countdown rides on the button so the name keeps the full
              width of a 240px drawer. */}
          {pending ? "Undoing…" : `Undo ${remainingLabel}`}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-arrived-border bg-arrived-soft px-4 py-3 shadow-card">
      <div className="min-w-0">
        {/* Wraps to two lines rather than truncating: a long surname still has
            to stay readable beside the Undo button. */}
        <p className="line-clamp-2 break-words font-display text-lg font-bold leading-tight text-arrived-deep">
          {displayName} — arrived
        </p>
        <p className="font-mono text-xs uppercase tracking-eyebrow text-arrived">
          Undo window {remainingLabel}
        </p>
      </div>
      <Button variant="danger" size="md" disabled={pending} onClick={onUndo}>
        {pending ? "Undoing…" : "Undo"}
      </Button>
    </div>
  );
}
