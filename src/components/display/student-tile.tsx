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
  const meta = [student.grade, student.class_group].filter(Boolean).join(" · ");

  return (
    <li
      className={cn(
        "relative flex max-h-[20rem] min-h-[8rem] flex-col justify-between overflow-hidden rounded-2xl p-4 text-white sm:min-h-[9rem] sm:p-5",
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

      <p className="relative truncate font-mono text-[0.6875rem] uppercase tracking-eyebrow text-white/75">
        {meta || " "}
      </p>

      {/* min-h-0 matters more than it looks: without it this block's
          intrinsic height (a two-line surname) becomes the grid row's
          min-content size and pushes the last row off a 1080p screen. Nobody
          scrolls a board mounted on a wall, so the tile clips instead. */}
      <div className="relative mt-1 flex min-h-0 min-w-0 flex-1 flex-col justify-center overflow-hidden">
        {/* The surname is the thing being read from twenty feet away, so it
            scales with the screen rather than sitting at a fixed step off the
            type scale. On a 1080p wall TV that is ~46px instead of ~30px; the
            clamp floor keeps it sane on a laptop, the ceiling stops it
            overwhelming the tile on a very wide display. */}
        <p className="line-clamp-2 break-words font-display text-[clamp(1.5rem,2.4vw,3.25rem)] font-extrabold leading-tight tracking-display">
          {student.last_name}
        </p>
        <p className="truncate text-[clamp(1rem,1.1vw,1.5rem)] font-medium text-white/85">
          {student.first_name}
        </p>
      </div>

      {/* Not decoration and not redundant: it is the whole signal for anyone
          in the room who cannot separate the red from the green. */}
      <p className="relative mt-3 font-mono text-[clamp(0.6875rem,0.7vw,1rem)] uppercase tracking-eyebrow text-white/85">
        {arrived ? "Arrived" : "Waiting"}
      </p>
    </li>
  );
}
