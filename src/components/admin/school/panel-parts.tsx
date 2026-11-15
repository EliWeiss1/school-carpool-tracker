import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/** The one input look in the admin screen (same as the class manager's). */
export const INPUT_CLASS =
  "focus-ring min-h-tap w-full rounded-xl border border-curb-300 bg-curb-50 px-3.5 text-curb-900 transition-colors duration-150 placeholder:text-curb-400 hover:border-curb-400";

export const LABEL_CLASS = "mb-1 block text-sm font-medium text-curb-700";

/** An elevated admin section: heading, one line of purpose, then content. */
export function PanelCard({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="flex flex-col gap-6 rounded-2xl border border-curb-200 bg-white p-6 shadow-card"
    >
      <div>
        <h2
          id={`${id}-heading`}
          className="font-display text-2xl font-bold text-curb-900"
        >
          {title}
        </h2>
        {intro && <p className="mt-1 text-curb-600">{intro}</p>}
      </div>
      {children}
    </section>
  );
}

/** A group inside a card, set off by a hairline rather than another card. */
export function PanelGroup({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-t border-curb-200 pt-6",
        className,
      )}
    >
      <h3 className="font-display text-lg font-bold text-curb-900">{title}</h3>
      {children}
    </div>
  );
}
