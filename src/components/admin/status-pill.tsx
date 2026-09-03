import { cn } from "@/lib/cn";
import type { StudentStatus } from "@/types/db";

/**
 * The one place /admin renders a status, so the red/green meaning stays
 * exactly what CLAUDE.md says it has to be everywhere else: waiting or
 * arrived, nothing else, using the same `waiting`/`arrived` scales as
 * /announce and /display.
 */
export function StatusPill({ status }: { status: StudentStatus }) {
  const isArrived = status === "arrived";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        isArrived
          ? "border-arrived-border bg-arrived-soft text-arrived-deep"
          : "border-waiting-border bg-waiting-soft text-waiting-deep",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          isArrived ? "bg-arrived" : "bg-waiting",
        )}
      />
      {isArrived ? "Arrived" : "Waiting"}
    </span>
  );
}
