import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * An empty screen is an invitation to act, so this always takes a title that
 * says what is true and a line that says what to do next.
 */
export function EmptyState({
  title,
  hint,
  action,
  className,
}: {
  title: string;
  hint: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-2xl border border-dashed border-curb-300 bg-white px-6 py-12 text-center",
        className,
      )}
    >
      <h2 className="font-display text-xl font-bold text-curb-900">{title}</h2>
      <p className="max-w-sm text-curb-600">{hint}</p>
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
