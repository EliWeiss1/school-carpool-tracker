import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * The one place an error reaches a staff member.
 *
 * `message` is rendered verbatim: the Edge Functions already write one sentence
 * someone can act on, and paraphrasing it here would lose the only instruction
 * that matters ("use the typed search instead"). Never put a status code, a
 * stack, or the word "error" in it.
 */
export function ErrorBanner({
  message,
  tone = "error",
  retry,
  children,
  className,
}: {
  message: string;
  /** `warning` for something that degraded but did not fail — a missed audit row. */
  tone?: "error" | "warning";
  retry?: { label: string; onClick: () => void };
  /** Extra actions, e.g. a "Type the name instead" escape hatch. */
  children?: ReactNode;
  className?: string;
}) {
  const isWarning = tone === "warning";

  return (
    <div
      role={isWarning ? "status" : "alert"}
      aria-live={isWarning ? "polite" : "assertive"}
      className={cn(
        "flex flex-col gap-3 rounded-xl border p-4 shadow-card sm:flex-row sm:items-center sm:justify-between",
        isWarning
          ? "border-marigold-300 bg-marigold-50 text-curb-800"
          : "border-waiting-border bg-waiting-soft text-waiting-deep",
        className,
      )}
    >
      <p className="text-base font-medium leading-snug">{message}</p>

      {(retry || children) && (
        <div className="flex shrink-0 gap-2">
          {children}
          {retry && (
            <Button variant="secondary" size="md" onClick={retry.onClick}>
              {retry.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
