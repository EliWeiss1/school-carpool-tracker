import Link from "next/link";
import type { ReactNode } from "react";

import { HazardRule } from "@/components/ui/hazard-rule";
import { cn } from "@/lib/cn";

/**
 * The chrome every route shares: an ink bar, the route name in the display
 * face, room for one action on the right, and the hazard rule underneath.
 *
 * It exists so that three screens built separately still read as one app — the
 * header is the thing a person sees first on all three.
 */
export function PageHeader({
  eyebrow,
  title,
  action,
  live = false,
  dense = false,
  className,
}: {
  /** Who this screen is for. Small caps, above the title. */
  eyebrow: string;
  title: string;
  action?: ReactNode;
  /** Animates the hazard rule. /announce sets this while the mic is open. */
  live?: boolean;
  /**
   * One line on a phone: the eyebrow is dropped below `sm`. For a screen where
   * the height under the header is the scarce thing (/announce), the route
   * name alone is enough to say where you are.
   */
  dense?: boolean;
  className?: string;
}) {
  return (
    <header className={cn("sticky top-0 z-20", className)}>
      <div
        className={cn(
          "flex items-center bg-curb-900 text-white",
          dense
            ? "gap-3 px-4 py-1 sm:gap-4 sm:px-6 sm:py-3"
            : "gap-4 px-6 py-3",
        )}
      >
        <Link
          href="/"
          className={cn(
            "focus-ring rounded-lg text-marigold-400 transition-opacity hover:opacity-80 active:opacity-60",
            dense && "flex min-h-tap items-center",
          )}
          aria-label="All screens"
        >
          <span
            aria-hidden="true"
            className="font-display text-xl font-extrabold"
          >
            &#8592;
          </span>
        </Link>

        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "font-mono text-[0.6875rem] uppercase tracking-eyebrow text-marigold-400",
              dense && "hidden sm:block",
            )}
          >
            {eyebrow}
          </p>
          <h1 className="truncate font-display text-xl font-bold text-white">
            {title}
          </h1>
        </div>

        {action}
      </div>

      <HazardRule live={live} />
    </header>
  );
}
