import type { DisplaySection } from "@/lib/display-sections";

/**
 * The heading above one class section on the grouped board. Only rendered
 * when more than one section is visible -- a single filtered class needs no
 * heading repeating what the filter chip above already says.
 */
export function SectionHeading({ section }: { section: DisplaySection }) {
  return (
    <div className="col-span-full flex items-baseline justify-between gap-3 border-b border-white/10 px-1 pb-1 pt-2 first:pt-0">
      <h2 className="font-mono text-xs uppercase tracking-eyebrow text-marigold-400">
        {section.label}
      </h2>
      <p className="whitespace-nowrap font-mono text-xs text-white/60">
        <span className="text-waiting-screen">{section.waiting} waiting</span>
      </p>
    </div>
  );
}
