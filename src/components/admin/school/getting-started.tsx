import type { ChecklistItem } from "@/lib/school-checklist";
import { cn } from "@/lib/cn";

import { PanelCard } from "./panel-parts";

/**
 * Not green: green means arrived. A finished step is solid ink with a tick; the
 * next step to do carries the brand marigold ring so the eye lands on it.
 */
function StepMark({
  done,
  current,
  number,
}: {
  done: boolean;
  current: boolean;
  number: number;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-sm font-medium",
        done
          ? "bg-curb-900 text-white"
          : current
            ? "border-2 border-marigold-500 bg-marigold-50 text-curb-900"
            : "border border-curb-300 text-curb-500",
      )}
    >
      {done ? (
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none">
          <path
            d="M3 8.5l3.2 3L13 4.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        number
      )}
    </span>
  );
}

/** The ordered checklist. The caller hides it once every step is done. */
export function GettingStarted({ items }: { items: readonly ChecklistItem[] }) {
  const currentId = items.find((item) => !item.done)?.id;
  const remaining = items.filter((item) => !item.done).length;

  return (
    <PanelCard
      id="getting-started"
      title="Getting started"
      intro={`${remaining} ${remaining === 1 ? "step" : "steps"} left before your school is ready for pickup.`}
    >
      <ol className="flex flex-col gap-3">
        {items.map((item, index) => (
          <li key={item.id} className="flex items-start gap-3">
            <StepMark
              done={item.done}
              current={item.id === currentId}
              number={index + 1}
            />
            <div className="min-w-0">
              <p
                className={cn(
                  "font-medium",
                  item.done ? "text-curb-500 line-through" : "text-curb-900",
                )}
              >
                {item.title}
                {item.done && <span className="sr-only"> (done)</span>}
              </p>
              {!item.done && (
                <p className="text-sm text-curb-600">{item.hint}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </PanelCard>
  );
}
