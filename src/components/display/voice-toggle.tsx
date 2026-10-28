"use client";

import { cn } from "@/lib/cn";

/**
 * Turns spoken names on and off for this one screen. Sits beside
 * `SoundToggle` in the header and matches it: small and quiet, because the
 * board has to work with nobody ever touching it.
 *
 * Three states, because the browser adds one:
 * - off: nothing is read.
 * - on: names are read after the chime.
 * - on but blocked: voice was left on, the page was reloaded, and the
 *   browser will not speak until someone taps the page. Tapping this is that
 *   tap, so it reads as a prompt rather than as "on".
 */
export function VoiceToggle({
  on,
  blocked,
  onToggle,
  className,
}: {
  on: boolean;
  blocked: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const label = !on
    ? "Read names: off"
    : blocked
      ? "Tap to read names"
      : "Read names: on";

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on && !blocked}
      className={cn(
        "focus-ring inline-flex min-h-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-transform duration-150 ease-spring active:scale-[0.97]",
        on && !blocked
          ? "border-marigold-400/60 bg-marigold-400/15 text-marigold-400 hover:bg-marigold-400/25 active:bg-marigold-400/30"
          : "border-white/20 bg-white/10 text-white/90 hover:bg-white/20 active:bg-white/25",
        on && blocked && "border-marigold-400/60",
        className,
      )}
    >
      <span aria-hidden="true">{on && !blocked ? "🔊" : "🔈"}</span>
      {/* Icon-only on a phone, where this shares one header line with the
          route name and the counts; the colour still shows on/off, and the
          label stays for screen readers. */}
      <span className="sr-only sm:not-sr-only">{label}</span>
    </button>
  );
}
