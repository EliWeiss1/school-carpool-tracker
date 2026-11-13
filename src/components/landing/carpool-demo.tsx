"use client";

import { useState } from "react";

import { StudentTile } from "@/components/display/student-tile";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  announceCarpool,
  announceLabel,
  CARPOOL_BOARD,
  CARPOOL_HEARD,
  CARPOOL_NAME,
  CARPOOL_RIDER_IDS,
  carpoolTiles,
  initialCarpoolDemo,
  isRiding,
  resetCarpoolDemo,
  toggleRider,
} from "@/lib/landing-carpool";

/**
 * The carpool section's picture, and the one thing on the landing page a
 * visitor can operate: one surname has been heard, the whole carpool is
 * offered ticked, and tapping Announce turns those tiles on the board beside
 * it. Unticking a rider first leaves that child waiting.
 *
 * Real controls, unlike the hero's loop, so they are real buttons with real
 * names. Nothing moves until the visitor acts, so there is no reduced-motion
 * variant to maintain: the tile's own flash is already neutralised globally.
 * The rules live in `lib/landing-carpool.ts`.
 */
export function CarpoolDemo() {
  const [state, setState] = useState(initialCarpoolDemo);

  const tiles = carpoolTiles(state);
  const riders = CARPOOL_BOARD.filter((child) =>
    CARPOOL_RIDER_IDS.includes(child.id),
  );
  const label = announceLabel(state);
  const nobodyTicked = !state.announced && label === "Tick a rider";

  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] sm:items-start lg:gap-6">
      {/* The curb phone. */}
      <div className="rounded-2xl bg-white p-4 text-curb-900 shadow-float">
        <p className="flex items-center gap-3 font-display text-2xl font-extrabold">
          <span
            aria-hidden="true"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-curb-900 text-marigold-400"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-6 w-6"
            >
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          </span>
          <span>
            <span className="sr-only">Heard: </span>&ldquo;{CARPOOL_HEARD}
            &rdquo;
          </span>
        </p>

        <fieldset className="mt-4" disabled={state.announced}>
          <legend className="font-display text-lg font-bold">
            {CARPOOL_NAME}
          </legend>
          <ul className="mt-2 flex flex-col gap-2">
            {riders.map((rider) => {
              const riding = isRiding(state, rider.id);
              return (
                <li key={rider.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={riding}
                    onClick={() =>
                      setState((current) => toggleRider(current, rider.id))
                    }
                    className={cn(
                      "focus-ring flex min-h-tap w-full items-center gap-3 rounded-xl border px-3 text-left font-display text-lg font-bold",
                      "transition-[transform,opacity] duration-200 ease-spring",
                      "enabled:hover:border-curb-400 enabled:active:scale-[0.98] enabled:active:shadow-press",
                      "disabled:cursor-default",
                      riding
                        ? "border-curb-300 bg-curb-50 text-curb-900"
                        : "border-curb-200 bg-white text-curb-400",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-2",
                        riding
                          ? "border-curb-900 bg-curb-900 text-marigold-400"
                          : "border-curb-300 bg-white text-transparent",
                      )}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-4 w-4"
                      >
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    </span>
                    <span className={cn(!riding && "line-through")}>
                      {rider.first_name} {rider.last_name}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </fieldset>

        <div className="mt-4 flex flex-col gap-2">
          <Button
            size="md"
            className="w-full"
            disabled={state.announced || nobodyTicked}
            onClick={() => setState(announceCarpool)}
          >
            {label}
          </Button>
          {state.announced && (
            <Button
              variant="quiet"
              size="md"
              className="w-full"
              onClick={() => setState(resetCarpoolDemo())}
            >
              Start over
            </Button>
          )}
        </div>
      </div>

      {/* The board inside. Decorative for assistive tech: the announcement
          below says what changed, which a grid of tiles cannot. */}
      <div className="rounded-2xl border border-white/10 bg-ink p-3 shadow-float sm:p-4">
        <ul
          aria-hidden="true"
          className="grid grid-cols-2 gap-2 [grid-auto-rows:6rem] sm:gap-3 sm:[grid-auto-rows:7rem] lg:grid-cols-3 lg:[grid-auto-rows:8rem]"
        >
          {tiles.map((tile) => (
            <StudentTile
              key={tile.student.id}
              student={tile.student}
              flashing={tile.flashing}
            />
          ))}
        </ul>
        <p role="status" className="sr-only">
          {state.announced
            ? `${tiles.filter((tile) => tile.flashing).length} riders are now shown as arrived on the board.`
            : ""}
        </p>
      </div>
    </div>
  );
}
