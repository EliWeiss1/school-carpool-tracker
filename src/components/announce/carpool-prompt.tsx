"use client";

import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { PadStudent } from "@/lib/class-roster";

/**
 * "Who is riding?" -- raised over the class drawer when a tapped name has
 * carpool-mates still waiting.
 *
 * Everyone starts ticked, matching how a carpool behaves when it is announced
 * by voice: the whole carpool goes unless someone is told to stay out. One
 * button takes everyone ticked ("Select whole carpool" when nobody has been
 * un-ticked), and un-ticking a name is how a sibling who is not riding today
 * is left out. Cancelling selects nobody.
 *
 * It only *selects*. Nothing is announced until the drawer's own Announce
 * button is pressed, same as every other pick.
 *
 * Members are listed with their class because siblings are often in different
 * classes, and the carpool's own name is not readable by the browser (that
 * table has no public access), so the names are what identifies it.
 */
export function CarpoolPrompt({
  members,
  unchecked,
  onToggle,
  onConfirm,
  onCancel,
}: {
  /** Waiting members of the carpool, including the student who was tapped. */
  members: PadStudent[];
  /** Ids the staff member has un-ticked. */
  unchecked: string[];
  onToggle: (studentId: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const off = new Set(unchecked);
  const ticked = members.length - members.filter((m) => off.has(m.id)).length;
  const everyone = ticked === members.length;

  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end rounded-l-2xl bg-ink/40">
      {/* A tap outside the card is the same as Cancel. */}
      <button
        type="button"
        aria-label="Cancel"
        tabIndex={-1}
        onClick={onCancel}
        className="min-h-0 flex-1 cursor-default"
      />

      <div
        role="group"
        aria-label="Carpool"
        className="m-2 flex max-h-[85%] flex-col overflow-hidden rounded-2xl bg-white shadow-float"
      >
        <div className="px-4 pb-2 pt-4">
          <h3 className="font-display text-lg font-bold leading-tight text-curb-900">
            Select the carpool
          </h3>
          <p className="text-sm text-curb-500">
            Untick who isn&rsquo;t riding.
          </p>
        </div>

        <ul className="flex min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain px-3 py-2">
          {members.map((member) => {
            const isOn = !off.has(member.id);
            return (
              <li key={member.id}>
                <button
                  type="button"
                  aria-pressed={isOn}
                  onClick={() => onToggle(member.id)}
                  className={cn(
                    "focus-ring flex min-h-tap w-full touch-manipulation items-center gap-3 rounded-xl border-2 px-3 text-left",
                    "transition-[transform,background-color,border-color] duration-150 ease-spring active:scale-[0.98]",
                    isOn
                      ? "border-marigold-500 bg-marigold-50"
                      : "border-curb-200 bg-white active:bg-curb-100 [@media(hover:hover)]:hover:bg-curb-50",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2",
                      isOn
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
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-display text-lg font-bold text-curb-900">
                      {member.last_name}
                    </span>{" "}
                    <span className="text-curb-600">{member.first_name}</span>
                  </span>
                  {member.class_group && (
                    <span className="shrink-0 font-mono text-xs uppercase tracking-eyebrow text-curb-500">
                      {member.class_group}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex gap-2 p-3">
          <Button
            variant="quiet"
            size="tap"
            className="shrink-0 !px-3 !text-base"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="tap"
            fullWidth
            className="whitespace-nowrap !px-3 !text-base"
            disabled={ticked === 0}
            onClick={onConfirm}
          >
            {everyone ? `Select all ${ticked}` : `Select ${ticked}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
