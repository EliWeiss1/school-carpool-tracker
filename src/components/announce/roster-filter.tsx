"use client";

import { useId, useState } from "react";

import { cn } from "@/lib/cn";
import { narrowedLabel } from "@/lib/class-roster";

/**
 * Narrows /announce to any number of classes, which shrinks the keyterm list
 * the speech service hears and decides which classes the side rail offers.
 *
 * A wrap of toggle chips rather than `<select multiple>`: a native multi-select
 * is a tiny scroll box on iOS and a modal checklist on Android, neither of
 * which a gloved thumb can use. A chip is a 56px target that says on or off.
 *
 * Collapsed by default: on a phone at the kerb, the vertical inch it would
 * otherwise take between the header and the first candidate is worth more than
 * the filter is, most calls.
 */
export function RosterFilter({
  classGroups,
  narrowedTo,
  onToggle,
  onClear,
}: {
  /** The admin-editable class list, in display order. */
  classGroups: string[];
  /** The classes currently narrowed to. Empty means any class. */
  narrowedTo: string[];
  onToggle: (classGroup: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className="rounded-xl border border-curb-200 bg-white shadow-card">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="focus-ring flex min-h-tap w-full items-center justify-between gap-2 rounded-xl px-4 py-3 text-left transition-colors duration-150 active:bg-curb-100 [@media(hover:hover)]:hover:bg-curb-50"
        aria-expanded={open}
        aria-controls={panelId}
      >
        <span className="min-w-0 truncate font-mono text-xs uppercase tracking-eyebrow text-curb-500">
          {narrowedLabel(narrowedTo)}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "shrink-0 text-curb-400 transition-transform duration-150",
            open && "rotate-180",
          )}
        >
          &#9662;
        </span>
      </button>

      {open && (
        <div
          id={panelId}
          className="flex flex-wrap gap-2 border-t border-curb-200 px-4 py-4"
        >
          <Chip pressed={narrowedTo.length === 0} onClick={onClear}>
            All classes
          </Chip>
          {classGroups.map((classGroup) => (
            <Chip
              key={classGroup}
              pressed={narrowedTo.includes(classGroup)}
              onClick={() => onToggle(classGroup)}
            >
              {classGroup}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "focus-ring min-h-tap touch-manipulation rounded-xl border-2 px-4 font-display text-base font-semibold",
        "transition-[transform,background-color,border-color] duration-150 ease-spring active:scale-[0.97]",
        pressed
          ? "border-marigold-500 bg-marigold-50 text-curb-900"
          : "border-curb-200 bg-white text-curb-700 active:bg-curb-100 [@media(hover:hover)]:hover:border-curb-300 [@media(hover:hover)]:hover:bg-curb-50",
      )}
    >
      {children}
    </button>
  );
}
