import { cn } from "@/lib/cn";
import type { FilterOption } from "@/lib/display-sections";

/**
 * The per-viewer class filter: a horizontally scrollable row of chips, each
 * carrying its own waiting count. It is entirely local to this browser tab --
 * several teachers can each filter to their own class at the same time, off
 * the one public realtime subscription, with no server state at all (see
 * `display-sections.ts`).
 *
 * Doubles as section navigation on the unfiltered board and reads identically
 * on a touchscreen and a wall-mounted TV, which a dropdown would not.
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
    <div
      role="tablist"
      aria-label="Filter by class"
      className="flex gap-2 overflow-x-auto px-4 pb-1 sm:px-6"
    >
      <Chip
        label="All classes"
        selected={value === ""}
        onClick={() => onChange("")}
      />
      {options.map((option) => (
        <Chip
          key={option.key}
          label={option.label}
          count={option.waiting}
          selected={value === option.key}
          onClick={() => onChange(option.key)}
        />
      ))}
    </div>
  );
}

function Chip({
  label,
  count,
  selected,
  onClick,
}: {
  label: string;
  count?: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        "focus-ring flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 font-mono text-xs uppercase tracking-eyebrow transition-[background-color,color] duration-150",
        selected
          ? "bg-marigold-500 text-curb-900"
          : "bg-white/10 text-white/80 hover:bg-white/20",
      )}
    >
      {label}
      {count !== undefined && (
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[0.6875rem]",
            selected ? "bg-curb-900/15" : "bg-white/15",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
