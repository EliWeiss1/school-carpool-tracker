"use client";

import { type ReactNode, useEffect, useRef } from "react";

import { Button, ErrorBanner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { type PadStudent, countStatuses } from "@/lib/class-roster";

/**
 * One class's students, as tap targets, hanging off the class rail.
 *
 * It covers the page content but deliberately not the header, the rail or the
 * push-to-talk bar: staff can switch class from the rail, or hold the mic
 * button to call a name, without closing it. Tapping a name only *selects* it;
 * nothing is written until the one "Announce N" button is pressed, so a
 * mis-tap with a gloved thumb costs nothing. That keeps CLAUDE.md's rule --
 * a human always taps to confirm -- while still letting several names go out
 * in a single call.
 *
 * A green name is the reverse: tapping it sends that student back to waiting.
 * That is the only way to take an announcement back -- there is no timed undo
 * banner -- so it works at any time, for any student.
 *
 * Tapping a waiting name that has carpool-mates raises `prompt` over the
 * drawer (the screen decides when; this component only hosts it).
 *
 * Presentational: it renders what it is handed. `announce-screen.tsx` owns the
 * state and the write.
 */
export function ClassDrawer({
  classGroup,
  students,
  pickedIds,
  totalPicked,
  announcing,
  busy,
  loading,
  error,
  feedback,
  prompt,
  onTap,
  onClear,
  onAnnounce,
  onClose,
  onRetry,
}: {
  classGroup: string;
  /** This class only, already sorted. */
  students: PadStudent[];
  /** Ids picked in THIS class. */
  pickedIds: string[];
  /** Picks across every class -- what the Announce button will send. */
  totalPicked: number;
  /** True while the Announce button's own request is in flight. */
  announcing: boolean;
  /** True while any write is in flight; names are inert until it settles. */
  busy: boolean;
  loading: boolean;
  error: string | null;
  /** Banners and the undo window, shown here because the page behind is covered. */
  feedback: ReactNode;
  /** The carpool prompt, or null. Rendered over the drawer's own area. */
  prompt: ReactNode;
  onTap: (student: PadStudent) => void;
  onClear: () => void;
  onAnnounce: () => void;
  onClose: () => void;
  onRetry: () => void;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const { waiting, arrived } = countStatuses(students);
  const picked = new Set(pickedIds);

  // Not a modal -- the rail and mic stay live -- so no focus trap, but a
  // keyboard or screen-reader user should land inside it, and Escape should
  // close it.
  useEffect(() => {
    sectionRef.current
      ?.querySelector<HTMLButtonElement>("header button")
      ?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <section
      ref={sectionRef}
      role="dialog"
      aria-modal="false"
      aria-label={`${classGroup} students`}
      className="absolute inset-y-0 right-14 z-20 flex w-[min(20rem,calc(100%-5rem))] animate-drawer-in flex-col rounded-l-2xl border-l border-curb-200 bg-white shadow-float"
    >
      <header className="flex items-center justify-between gap-3 border-b border-curb-200 py-2 pl-4 pr-2">
        <div className="min-w-0">
          <h2 className="truncate font-display text-2xl font-bold leading-tight text-curb-900">
            {classGroup}
          </h2>
          {/* Plain sentence case, not an eyebrow: this is a status line, and
              wide-tracked caps would wrap it on a 320px phone. */}
          <p className="whitespace-nowrap text-sm text-curb-500">
            {students.length === 0
              ? "No students"
              : `${waiting} waiting, ${arrived} here`}
          </p>
        </div>
        <Button
          variant="quiet"
          size="md"
          // Important modifiers: `cn` joins classes without merging, so a plain
          // px-4 would lose to the size's own px-6 on stylesheet order.
          className="shrink-0 !px-4"
          onClick={onClose}
        >
          Close
        </Button>
      </header>

      {/* Keyed on the class so switching starts at the top of the new list. */}
      <div
        key={classGroup}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 [-webkit-overflow-scrolling:touch]"
      >
        {error && (
          <ErrorBanner
            message={error}
            retry={{ label: "Try again", onClick: onRetry }}
          />
        )}

        {!error && loading && (
          <p className="px-1 py-6 text-center text-curb-500">Loading names…</p>
        )}

        {!error && !loading && students.length === 0 && (
          <p className="px-1 py-6 text-center text-curb-500">
            No students are in {classGroup} yet.
          </p>
        )}

        <ul className="flex flex-col gap-2">
          {students.map((student) => (
            <li key={student.id}>
              <StudentRow
                student={student}
                selected={picked.has(student.id)}
                disabled={busy}
                onTap={() => onTap(student)}
              />
            </li>
          ))}
        </ul>
      </div>

      <footer className="flex flex-col gap-2 border-t border-curb-200 bg-white p-3">
        {feedback}
        <div className="flex gap-2">
          {totalPicked > 0 && (
            <Button
              variant="quiet"
              size="tap"
              className="shrink-0 !px-4 !text-base"
              disabled={busy}
              onClick={onClear}
            >
              Clear
            </Button>
          )}
          <Button
            variant="primary"
            size="tap"
            fullWidth
            className="!px-4 !text-base"
            disabled={totalPicked === 0 || busy}
            onClick={onAnnounce}
          >
            {announcing
              ? "Announcing…"
              : totalPicked === 0
                ? "Pick names to announce"
                : `Announce ${totalPicked}`}
          </Button>
        </div>
      </footer>

      {prompt}
    </section>
  );
}

function StudentRow({
  student,
  selected,
  disabled,
  onTap,
}: {
  student: PadStudent;
  selected: boolean;
  disabled: boolean;
  onTap: () => void;
}) {
  const here = student.status === "arrived";
  const fullName = `${student.first_name} ${student.last_name}`;

  return (
    <button
      type="button"
      disabled={disabled}
      // A green row is the already-announced state, and tapping it reverses
      // that, so it reads as "here" to a screen reader and says what a tap does.
      aria-pressed={here ? true : selected}
      aria-label={here ? `${fullName}, here. Tap to send back to waiting.` : fullName}
      onClick={onTap}
      className={cn(
        "focus-ring flex min-h-tap w-full touch-manipulation items-center gap-3 rounded-xl border-2 px-3 text-left",
        "transition-[transform,background-color,border-color] duration-150 ease-spring",
        "active:scale-[0.98] disabled:opacity-60",
        here
          ? "border-arrived-border bg-arrived-soft active:bg-arrived-border [@media(hover:hover)]:hover:bg-arrived-border"
          : cn(
              selected
                ? "border-marigold-500 bg-marigold-50"
                : "border-curb-200 bg-white active:bg-curb-100 [@media(hover:hover)]:hover:border-curb-300 [@media(hover:hover)]:hover:bg-curb-50",
            ),
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          // Square = a pick you can toggle; round = already here. Different
          // shapes, so a green tick is never mistaken for "selected".
          "flex h-6 w-6 shrink-0 items-center justify-center border-2",
          here ? "rounded-full" : "rounded-md",
          here
            ? "border-arrived bg-arrived text-white"
            : selected
              ? "border-marigold-600 bg-marigold-500 text-curb-900"
              : "border-curb-300 bg-white text-transparent",
        )}
      >
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none">
          <path
            d="M3 8.5 6.5 12 13 4.5"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>

      <span
        className="min-w-0 flex-1 truncate"
        title={fullName}
      >
        <span
          className={cn(
            "font-display text-lg font-bold",
            here ? "text-arrived-deep" : "text-curb-900",
          )}
        >
          {student.last_name}
        </span>{" "}
        <span className={here ? "text-arrived" : "text-curb-600"}>
          {student.first_name}
        </span>
      </span>

      {here && (
        <span className="shrink-0 font-mono text-xs uppercase tracking-eyebrow text-arrived">
          Here
        </span>
      )}
    </button>
  );
}
