import { cn } from "@/lib/cn";
import type { FilterOption } from "@/lib/display-sections";

/**
 * The per-viewer class filter: one compact dropdown rather than a row of
 * chips. With seven classes plus "All classes" a chip row would eat most of
 * the header on a wall-mounted screen; a single control reads the same at a
 * glance and leaves the rest of the header for the waiting/arrived count.
 *
 * Entirely local to this browser tab -- several teachers can each filter to
 * their own class at the same time, off the one public realtime subscription,
 * with no server state at all (see `display-sections.ts`).
 */
export function ClassFilter({
  options,
  value,
  onChange,
}: {
  options: FilterOption[];
  value: string;
  onChange: (sectionKey: string) => void;
}) {
  if (options.length <= 1) return null;

  return (
    <label className="flex items-center gap-2 px-4 sm:px-6">
      <span className="sr-only">Filter by class</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "focus-ring min-h-tap w-full max-w-xs rounded-xl border border-white/15 bg-white/10 px-3.5 font-mono text-xs uppercase tracking-eyebrow text-white/80 transition-colors duration-150 hover:bg-white/15 sm:w-auto",
        )}
      >
        <option value="" className="bg-curb-900 text-white">
          All classes
        </option>
        {options.map((option) => (
          <option
            key={option.key}
            value={option.key}
            className="bg-curb-900 text-white"
          >
            {option.label} ({option.waiting} waiting)
          </option>
        ))}
      </select>
    </label>
  );
}
