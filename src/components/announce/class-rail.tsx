"use client";

import { cn } from "@/lib/cn";

/**
 * A slim strip of class buttons down the right-hand edge, one per class on
 * offer. Tapping one opens that class's student drawer.
 *
 * The right edge on purpose: /announce is used one-handed, and the thumb that
 * holds the phone rests there. The strip is 56px wide, so it costs little
 * width, and it scrolls on its own when there are more classes than fit, so
 * it never pushes the mic button off the screen.
 *
 * A badge shows how many names are already picked in a class, so a pick made
 * in K1 is not forgotten while the drawer is showing 2nd.
 */
export function ClassRail({
  classes,
  openClass,
  pickedCount,
  onSelect,
}: {
  classes: string[];
  openClass: string | null;
  /** How many students are picked in a given class. */
  pickedCount: (classGroup: string) => number;
  onSelect: (classGroup: string) => void;
}) {
  return (
    <nav
      aria-label="Classes"
      className="absolute inset-y-0 right-0 z-10 flex w-14 flex-col gap-2 overflow-y-auto overscroll-contain border-l border-curb-200 bg-white p-1 [-webkit-overflow-scrolling:touch]"
    >
      {classes.map((classGroup) => {
        const isOpen = classGroup === openClass;
        const picked = pickedCount(classGroup);

        return (
          <button
            key={classGroup}
            type="button"
            aria-pressed={isOpen}
            aria-label={
              picked > 0
                ? `${classGroup}, ${picked} picked`
                : `${classGroup} students`
            }
            onClick={() => onSelect(classGroup)}
            className={cn(
              "focus-ring relative flex min-h-tap w-full shrink-0 touch-manipulation items-center justify-center rounded-xl px-1 text-center",
              "transition-[transform,background-color] duration-150 ease-spring active:scale-[0.96]",
              isOpen
                ? "bg-curb-900 text-white"
                : "bg-curb-100 text-curb-800 active:bg-curb-200 [@media(hover:hover)]:hover:bg-curb-200",
            )}
          >
            <span className="line-clamp-2 break-words font-display text-sm font-bold leading-tight">
              {classGroup}
            </span>
            {picked > 0 && (
              <span
                aria-hidden="true"
                className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-marigold-500 px-1 font-mono text-xs font-medium leading-none text-curb-900"
              >
                {picked}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
