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
  className,
}: {
  /** Who this screen is for. Small caps, above the title. */
  eyebrow: string;
  title: string;
  action?: ReactNode;
  /** Animates the hazard rule. /announce sets this while the mic is open. */
  live?: boolean;
  className?: string;
}) {
  return (
    <header className={cn("sticky top-0 z-20", className)}>
      <div className="flex items-center gap-4 bg-curb-900 px-6 py-3 text-white">
        <Link
          href="/"
          className="focus-ring rounded-lg text-marigold-400 transition-opacity hover:opacity-80"
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
          <p className="font-mono text-[0.6875rem] uppercase tracking-eyebrow text-marigold-400">
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
