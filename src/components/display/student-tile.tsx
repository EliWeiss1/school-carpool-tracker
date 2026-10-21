import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";
import type { Student } from "@/types/db";

/** Shortest name length the type is fitted for, so "Li" is not sized as two glyphs. */
const MIN_FIT_CHARS = 5;

/**
 * One child on the board. The status colour is the whole message -- readable
 * across a room, at an angle, before anyone reads a word of text -- so it is
 * the tile's entire fill, not an accent, using the `-screen` pair from
 * `tailwind.config.ts` (`waiting-screen`/`arrived-screen`) rather than the
 * light-surface `waiting`/`arrived` values, which disappear against ink.
 *
 * `flashing` (true for 15s after an arrival) drives two things: the two
 * keyframes already defined for exactly this (`animate-arrival-flash`,
 * `animate-arrival-glow`, both transform/opacity only, so they composite
 * cheaply on a wall-mounted machine, and both finishing in the first ~3s),
 * and a static gold hold for the whole 15s so a teacher can find the name
 * that was just announced. Under `prefers-reduced-motion` the global guard in
 * `globals.css` collapses the keyframes to near-zero; the gold hold is
 * motion-free, so the arrival stays obvious with no animation at all.
 */
export function StudentTile({
  student,
  flashing,
}: {
  student: Student;
  flashing: boolean;
}) {
  const arrived = student.status === "arrived";
  const announced = flashing && arrived;
  const meta = student.class_group ?? "";
  const nameFit = {
    "--name-chars": Math.max(student.last_name.length, MIN_FIT_CHARS),
    "--given-chars": Math.max(student.first_name.length, MIN_FIT_CHARS),
  } as CSSProperties;

  return (
    <li
      className={cn(
        // Horizontal padding is px-3, not p-4: the names are width-limited
        // (see .tile-surname), so 8px more content width is worth more than
        // symmetric padding. The tile itself is the same size.
        "tile-surface relative flex max-h-[20rem] min-h-[6rem] flex-col justify-between overflow-hidden rounded-2xl p-2.5 sm:min-h-[9rem] sm:px-3 sm:py-4",
        "animate-tile-in",
        // Arrived is a white tile, so its text flips to ink.
        arrived
          ? "bg-arrived-screen text-ink shadow-tile-arrived"
          : "bg-waiting-screen text-white shadow-tile-waiting",
        flashing && "animate-arrival-flash",
      )}
    >
      {/* The "just announced" hold: a gold layer over the white arrived tile
          for as long as `flashing` is true (15s). It is a layer, not a
          background swap, so it can fade back to white on opacity alone --
          colour transitions would repaint the tile on a slow display PC.
          Gated on `arrived` so a name sent back to waiting mid-hold drops
          its gold immediately instead of tinting a blue tile. */}
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 bg-marigold-400 opacity-0 transition-opacity duration-700 ease-out",
          announced && "opacity-100",
        )}
      />

      {/* The arrival glow: a pale-gold layer that flashes in and fades over
          the gold hold, for the first ~3s only. Opacity-only so it costs
          nothing to composite.

          `opacity-0` stays applied at all times, flashing or not -- it is the
          resting value the animation's own `fill: none` default reverts to
          the instant it finishes, not just the pre-flash state. That matters
          under `prefers-reduced-motion`: the global guard in globals.css
          forces `animation-duration: 0.01ms`, so the keyframes complete
          almost immediately and this layer sits reverted-to-resting for
          nearly all of the hold. Without a static `opacity-0` still in the
          cascade underneath, that revert falls back to the browser default
          (opacity: 1) instead -- an opaque tile hiding the child's name for
          seconds, which is what actually happened here before this fix. */}
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 bg-marigold-100 opacity-0",
          flashing && "animate-arrival-glow",
        )}
      />

      <p
        className={cn(
          "tile-label relative truncate font-mono uppercase tracking-eyebrow",
          arrived ? "text-ink/75" : "text-white/95",
        )}
      >
        {meta || " "}
      </p>

      {/* min-h-0 matters more than it looks: without it this block's
          intrinsic height (a two-line surname) becomes the grid row's
          min-content size and pushes the last row off a 1080p screen. Nobody
          scrolls a board mounted on a wall, so the tile clips instead. */}
      <div
        style={nameFit}
        className="relative mt-1 flex min-h-0 min-w-0 flex-1 flex-col justify-center overflow-hidden"
      >
        {/* Sized from the tile's own box and the name's length (see
            .tile-surname in globals.css), not the viewport: only the tile
            knows how much room a 105-child roster actually left it. */}
        <p className="tile-surname line-clamp-2 break-words font-display font-extrabold leading-tight tracking-display">
          {student.last_name}
        </p>
        <p
          className={cn(
            "tile-given-name truncate font-medium leading-tight",
            arrived ? "text-ink/80" : "text-white/95",
          )}
        >
          {student.first_name}
        </p>
      </div>

      {/* Not decoration and not redundant: it is the whole signal for anyone
          in the room who cannot separate the blue from the white. */}
      <p
        className={cn(
          "tile-label relative font-mono uppercase tracking-eyebrow",
          arrived ? "text-ink/85" : "text-white/95",
        )}
      >
        {arrived ? "Arrived" : "Waiting"}
      </p>
    </li>
  );
}
