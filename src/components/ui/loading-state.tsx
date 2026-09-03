import { cn } from "@/lib/cn";

/**
 * A placeholder while something loads.
 *
 * No spinner: a spinner says "wait" and nothing else. These are shaped like the
 * rows or tiles that are coming, so the screen does not jump when they land —
 * and on /display, which never has a person waiting at it, that stability
 * matters more than any animation would.
 */
export function LoadingState({
  label,
  rows = 4,
  className,
}: {
  /** Announced to a screen reader; not drawn. */
  label: string;
  rows?: number;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className={cn("flex flex-col gap-3", className)}
    >
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="h-tap animate-pulse rounded-xl border border-curb-200 bg-white/70"
          // A shallow stagger reads as loading rather than as a broken layout.
          style={{ animationDelay: `${index * 90}ms` }}
        />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}
