"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { classFilterLabel } from "@/lib/class-roster";

/**
 * Narrows /announce to any number of classes, which shrinks the keyterm list
 * the speech service hears and decides which classes the side rail offers.
 *
 * A button in the ink header rather than a card on the page: it is set once
 * at the start of a pickup, if at all, and as a card it took a full row
 * between the header and the first candidate on every call. In the header it
 * costs no height and still says what the screen is narrowed to.
 *
 * The chips open in a bottom sheet, where a thumb already is. A wrap of toggle
 * chips rather than `<select multiple>`: a native multi-select is a tiny scroll
 * box on iOS and a modal checklist on Android, neither of which a gloved thumb
 * can use. A chip is a 56px target that says on or off.
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
  const sheetId = useId();
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const narrowed = narrowedTo.length > 0;

  function close() {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }

  // A modal sheet: focus moves in, Escape leaves.
  useEffect(() => {
    if (!open) return;
    sheetRef.current
      ?.querySelector<HTMLButtonElement>("button")
      ?.focus({ preventScroll: true });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? sheetId : undefined}
        aria-label={
          narrowed
            ? `Classes: ${narrowedTo.join(", ")}. Change`
            : "Classes: all. Narrow"
        }
        className={cn(
          "focus-ring flex min-h-tap max-w-[9rem] items-center gap-1 rounded-xl px-3 font-display text-base font-semibold",
          "transition-[transform,background-color] duration-150 ease-spring active:scale-[0.97]",
          narrowed
            ? "bg-marigold-500 text-curb-900 hover:bg-marigold-400 active:bg-marigold-600"
            : "text-curb-300 hover:bg-white/10 hover:text-white active:bg-white/20",
        )}
      >
        <span className="truncate">{classFilterLabel(narrowedTo)}</span>
        <span aria-hidden="true" className="shrink-0 text-sm">
          &#9662;
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end">
          <button
            type="button"
            aria-label="Close class filter"
            tabIndex={-1}
            onClick={close}
            className="absolute inset-0 animate-tile-in bg-ink/50"
          />
          <div
            ref={sheetRef}
            id={sheetId}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="relative mx-auto flex w-full max-w-md animate-sheet-in flex-col gap-4 rounded-t-2xl bg-white px-4 pt-6 shadow-float"
            style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
          >
            <div>
              <h2
                id={titleId}
                className="font-display text-xl font-bold text-curb-900"
              >
                Which classes are you calling?
              </h2>
              <p className="text-sm text-curb-600">
                Voice listens for these names first, and the side rail shows
                only these classes.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Chip pressed={!narrowed} onClick={onClear}>
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

            <Button size="tap" fullWidth onClick={close}>
              Done
            </Button>
          </div>
        </div>
      )}
    </>
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
