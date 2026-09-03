import { cn } from "@/lib/cn";

/**
 * The painted hazard band from the pickup lane. It is the app's signature: it
 * appears exactly once per screen, immediately below the header.
 *
 * On /announce it earns a second job — set `live` while the microphone is open
 * and the same stripe that marks the lane outside starts moving, which is
 * readable from arm's length in sunlight in a way a small red dot is not.
 */
export function HazardRule({
  live = false,
  className,
}: {
  live?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn("hazard-rule", live && "hazard-rule--live", className)}
      aria-hidden="true"
    />
  );
}
