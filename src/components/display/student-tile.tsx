import { cn } from "@/lib/cn";
import type { Student } from "@/types/db";

/**
 * One child on the board. The status colour is the whole message -- readable
 * across a room, at an angle, before anyone reads a word of text -- so it is
 * the tile's entire fill, not an accent, using the `-screen` pair from
 * `tailwind.config.ts` (`waiting-screen`/`arrived-screen`) rather than the
 * light-surface `waiting`/`arrived` values, which disappear against ink.
 *
 * `flashing` drives the two keyframes already defined for exactly this
 * (`animate-arrival-flash`, `animate-arrival-glow`) -- both transform/opacity
 * only, so they composite cheaply on a wall-mounted machine. Under
 * `prefers-reduced-motion` the global guard in `globals.css` collapses their
 * duration to near-zero; the tile's own colour flip from waiting-screen to
 * arrived-screen still carries the news with no motion at all.
 */
export function StudentTile({
  student,
  flashing,
}: {
  student: Student;
  flashing: boolean;
}) {
  const arrived = student.status === "arrived";
  const meta = student.class_group ?? "";

  return (
    <li
      className={cn(
        "tile-surface relative flex max-h-[20rem] min-h-[6rem] flex-col justify-between overflow-hidden rounded-2xl p-2.5 text-white sm:min-h-[9rem] sm:p-4",
        "animate-tile-in",
        arrived
          ? "bg-arrived-screen shadow-tile-arrived"
          : "bg-waiting-screen shadow-tile-waiting",
        flashing && "animate-arrival-flash",
      )}
    >
      {/* The arrival glow: a white layer that flashes in and fades, over the
          tile's own colour. Opacity-only so it costs nothing to composite.

          `opacity-0` stays applied at all times, flashing or not -- it is the
          resting value the animation's own `fill: none` default reverts to
          the instant it finishes, not just the pre-flash state. That matters
          under `prefers-reduced-motion`: the global guard in globals.css
          forces `animation-duration: 0.01ms`, so the keyframes complete
          almost immediately and this layer sits reverted-to-resting for
          nearly all of `flashing`'s ~3.4s window. Without a static
          `opacity-0` still in the cascade underneath, that revert falls back
          to the browser default (opacity: 1) instead -- an opaque white tile
          hiding the child's name for seconds, which is what actually
          happened here before this fix. */}
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 bg-white opacity-0",
          flashing && "animate-arrival-glow",
        )}
      />

      <p className="tile-label relative truncate font-mono uppercase tracking-eyebrow text-white/75">
        {meta || " "}
      </p>

      {/* min-h-0 matters more than it looks: without it this block's
          intrinsic height (a two-line surname) becomes the grid row's
          min-content size and pushes the last row off a 1080p screen. Nobody
          scrolls a board mounted on a wall, so the tile clips instead. */}
      <div className="relative mt-1 flex min-h-0 min-w-0 flex-1 flex-col justify-center overflow-hidden">
        {/* Sized from the tile's own height (see .tile-surname in
            globals.css), not the viewport: only the tile knows how much room
            a 36-child roster actually left it. */}
        <p className="tile-surname line-clamp-2 break-words font-display font-extrabold leading-tight tracking-display">
          {student.last_name}
        </p>
        <p className="tile-given-name truncate font-medium leading-tight text-white/85">
          {student.first_name}
        </p>
      </div>

      {/* Not decoration and not redundant: it is the whole signal for anyone
          in the room who cannot separate the red from the green. */}
      <p className="tile-label relative font-mono uppercase tracking-eyebrow text-white/85">
        {arrived ? "Arrived" : "Waiting"}
      </p>
    </li>
  );
}
