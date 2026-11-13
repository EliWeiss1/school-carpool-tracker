"use client";

import { useEffect, useMemo, useState } from "react";

import { StudentTile } from "@/components/display/student-tile";
import { cn } from "@/lib/cn";
import {
  advanceDemo,
  childBeingCalled,
  demoStepDelayMs,
  demoTiles,
  initialDemoState,
  stillDemoState,
  type DemoPhase,
} from "@/lib/landing-demo";

/** True when the visitor's OS asks for less motion. False on the server. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return reduced;
}

const CONFIRM_LABEL: Record<DemoPhase, string> = {
  listening: "Confirm",
  heard: "Confirm",
  confirmed: "Confirmed",
};

/**
 * The landing page's one moving thing: the product doing its job. A name is
 * heard at the curb, a person confirms it, and the child's tile on the board
 * turns -- drawn with the real board tile, so what a visitor sees here is what
 * a teacher sees on the wall.
 *
 * The script lives in `lib/landing-demo.ts`; this only schedules it. Under
 * `prefers-reduced-motion` the loop does not run at all and one still frame is
 * shown instead. The whole thing is hidden from assistive tech and described
 * in a sentence, because a looping animation read aloud is noise.
 */
export function PickupDemo() {
  const reducedMotion = usePrefersReducedMotion();
  const [looping, setLooping] = useState(initialDemoState);

  useEffect(() => {
    if (reducedMotion) return;
    const timer = window.setTimeout(
      () => setLooping(advanceDemo),
      demoStepDelayMs(looping.phase),
    );
    return () => window.clearTimeout(timer);
  }, [looping, reducedMotion]);

  // Derived, not stored: storing the still frame would re-trigger the effect.
  const state = useMemo(
    () => (reducedMotion ? stillDemoState() : looping),
    [reducedMotion, looping],
  );

  const tiles = demoTiles(state);
  const child = childBeingCalled(state);
  const calledCount = state.arrivedIds.length;

  return (
    <div className="relative">
      <p className="sr-only">
        Example: a staff member at the curb says the name Cohen, taps Confirm,
        and Maya Cohen&rsquo;s tile on the board inside changes from waiting to
        arrived.
      </p>

      <div aria-hidden="true">
        {/* The board, as it looks on a screen inside. */}
        <div className="rounded-2xl border border-white/10 bg-ink p-3 shadow-float sm:p-4">
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <p className="font-display text-sm font-semibold text-white">
              Pickup board
            </p>
            <p className="font-mono text-sm text-waiting-lift">
              {calledCount} of {tiles.length} called
            </p>
          </div>
          <ul className="grid grid-cols-3 gap-2 [grid-auto-rows:6rem] sm:gap-3 sm:[grid-auto-rows:9rem]">
            {tiles.map((tile) => (
              <StudentTile
                key={tile.student.id}
                student={tile.student}
                flashing={tile.flashing}
              />
            ))}
          </ul>
        </div>

        {/* The curb phone, overlapping the board it controls. Fixed height so
            the three phases never shift the layout around it. */}
        <div className="relative -mt-3 ml-4 w-64 rounded-2xl bg-white p-4 shadow-float sm:ml-8 sm:w-72">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-curb-500">At the curb</p>
            <span className="relative flex h-3 w-3">
              {state.phase === "listening" && (
                <span className="absolute inset-0 animate-listen-pulse rounded-full bg-marigold-500" />
              )}
              <span
                className={cn(
                  "relative h-3 w-3 rounded-full",
                  state.phase === "listening"
                    ? "bg-marigold-500"
                    : "bg-curb-300",
                )}
              />
            </span>
          </div>

          <p className="mt-1 h-8 truncate font-display text-2xl font-bold leading-8 text-curb-900">
            {state.phase === "listening" ? (
              <span className="text-curb-400">Listening</span>
            ) : (
              <>&ldquo;{child.last_name}&rdquo;</>
            )}
          </p>

          {/* Drawn as the product's confirm button, but not a control: the
              whole demo is aria-hidden and nothing here can be pressed. */}
          <div
            className={cn(
              "mt-3 flex min-h-tap items-center justify-center rounded-xl px-4 font-display font-semibold transition-[transform,opacity] duration-200 ease-spring",
              state.phase === "listening" &&
                "border border-curb-200 text-curb-400 opacity-60",
              state.phase === "heard" &&
                "bg-marigold-500 text-curb-900 shadow-card",
              state.phase === "confirmed" &&
                "scale-[0.97] bg-curb-100 text-curb-600 shadow-press",
            )}
          >
            <span className="truncate">
              {CONFIRM_LABEL[state.phase]}
              {state.phase !== "listening" &&
                ` ${child.first_name} ${child.last_name}`}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
