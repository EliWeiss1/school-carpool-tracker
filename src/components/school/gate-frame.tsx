import type { ReactNode } from "react";

import { BrandBar } from "@/components/auth/brand-bar";
import { cn } from "@/lib/cn";

/**
 * What a school gate shows in place of the screen while it has nothing to show
 * yet (resolving, or asking for a code): the brand bar with the screen's one
 * hazard rule, then the page ground. The board lives on a wall, so it keeps
 * its ink ground even here; everything else uses the light base.
 *
 * Only used when the gate is *not* showing the screen, because the screens
 * render their own header and rule and a second one would break "exactly once".
 */
export function GateFrame({
  ground = "light",
  children,
}: {
  ground?: "light" | "ink";
  children: ReactNode;
}) {
  return (
    <main
      className={cn(
        "flex min-h-screen flex-col",
        ground === "ink" ? "bg-ink" : "bg-curb-50",
      )}
    >
      <BrandBar />
      <div className="flex flex-1 items-start justify-center px-4 py-8 sm:items-center sm:py-12">
        {children}
      </div>
    </main>
  );
}
