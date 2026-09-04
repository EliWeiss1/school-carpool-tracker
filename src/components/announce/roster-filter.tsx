"use client";

import { useId, useState } from "react";

import { CLASS_GROUPS } from "@/lib/classes";
import { cn } from "@/lib/cn";

export interface AnnounceFilterValue {
  classGroup: string;
}

/**
 * The optional class narrowing from the phase 4 checklist. Collapsed by
 * default: on a phone at the kerb, the vertical inch it would otherwise take
 * between the header and the first candidate is worth more than the filter
 * is, most calls.
 */
export function RosterFilter({
  value,
  onChange,
}: {
  value: AnnounceFilterValue;
  onChange: (field: keyof AnnounceFilterValue, next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const classId = useId();
  const isNarrowed = value.classGroup.trim() !== "";

  return (
    <div className="rounded-xl border border-curb-200 bg-white shadow-card">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="focus-ring flex w-full items-center justify-between gap-2 rounded-xl px-4 py-3 text-left transition-colors duration-150 hover:bg-curb-50 active:bg-curb-100"
        aria-expanded={open}
      >
        <span className="font-mono text-xs uppercase tracking-eyebrow text-curb-500">
          {isNarrowed ? `Narrowed to ${value.classGroup}` : "Narrow by class"}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "text-curb-400 transition-transform duration-150",
            open && "rotate-180",
          )}
        >
          &#9662;
        </span>
      </button>

      {open && (
        <div className="border-t border-curb-200 px-4 py-3">
          <label className="flex flex-col gap-1">
            <span
              id={classId}
              className="font-mono text-[0.6875rem] uppercase tracking-eyebrow text-curb-500"
            >
              Class
            </span>
            <select
              aria-labelledby={classId}
              value={value.classGroup}
              onChange={(event) => onChange("classGroup", event.target.value)}
              className="focus-ring min-h-tap rounded-lg border border-curb-300 bg-curb-50 px-3 text-base text-curb-900"
            >
              <option value="">Any class</option>
              {CLASS_GROUPS.map((classGroup) => (
                <option key={classGroup} value={classGroup}>
                  {classGroup}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
