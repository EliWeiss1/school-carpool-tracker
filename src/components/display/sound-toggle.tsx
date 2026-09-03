"use client";

import { cn } from "@/lib/cn";

/**
 * Shown only while the browser is blocking audio -- most browsers refuse
 * autoplay before any gesture on the page, and a wall-mounted board is
 * loaded with nobody around to click anything. Tapping this is that first
 * gesture: the click handler calls the same chime player directly, so the
 * click itself both unlocks and confirms sound is working.
 *
 * Small and quiet on purpose. The board has to work with nobody ever
 * noticing this exists.
 */
export function SoundToggle({
  onEnable,
  className,
}: {
  onEnable: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onEnable}
      className={cn(
        "focus-ring inline-flex min-h-0 items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium text-white/90 transition-colors duration-150 hover:bg-white/20 active:bg-white/25",
        className,
      )}
    >
      <span aria-hidden="true">🔇</span>
      Enable sound
    </button>
  );
}
