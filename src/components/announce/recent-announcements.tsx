"use client";

import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { type PadStudent, classesLabel } from "@/lib/class-roster";

/**
 * What /announce shows between calls: the last few names this device marked
 * arrived, each with a way to take it back.
 *
 * It replaces a large "Ready when you are" card that held the best spot on
 * the screen and said nothing the mic button didn't. A wrong tap is the
 * mistake most worth catching right after it happens, and since the timed
 * undo banner went, the only way back was finding the name in its class
 * drawer. Here it is one tap from where the confirm just happened.
 *
 * Statuses come from the live roster, not from this device's memory, so a
 * name someone else already sent back reads as waiting and offers nothing.
 * Presentational: `announce-screen.tsx` owns the list and the write.
 */
export function RecentAnnouncements({
  students,
  busyId,
  disabled,
  onSendBack,
}: {
  /** Newest first. Empty renders nothing. */
  students: PadStudent[];
  /** The student currently being sent back, if any. */
  busyId: string | null;
  /** True while any write is in flight. */
  disabled: boolean;
  onSendBack: (student: PadStudent) => void;
}) {
  if (students.length === 0) return null;

  return (
    <section
      aria-labelledby="recent-heading"
      className="animate-tile-in rounded-2xl border border-curb-200 bg-white shadow-card"
    >
      <h2
        id="recent-heading"
        className="px-4 pb-2 pt-4 font-mono text-xs uppercase tracking-eyebrow text-curb-500"
      >
        Just announced
      </h2>
      <ul className="flex flex-col">
        {students.map((student) => {
          const here = student.status === "arrived";
          const fullName = `${student.first_name} ${student.last_name}`;

          return (
            <li
              key={student.id}
              className="flex min-h-tap-lg items-center gap-3 border-t border-curb-100 py-2 pl-4 pr-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  <span
                    className={cn(
                      "font-display text-lg font-bold",
                      here ? "text-curb-900" : "text-curb-500",
                    )}
                  >
                    {student.last_name}
                  </span>{" "}
                  <span className="text-curb-600">{student.first_name}</span>
                </span>
                <span className="block font-mono text-xs uppercase tracking-eyebrow text-curb-500">
                  {here ? classesLabel(student.class_groups) : "Back to waiting"}
                </span>
              </span>

              {here && (
                <Button
                  variant="danger"
                  size="md"
                  className="min-h-tap-lg shrink-0 !px-4"
                  disabled={disabled}
                  aria-label={`Send ${fullName} back to waiting`}
                  onClick={() => onSendBack(student)}
                >
                  {busyId === student.id ? "Sending…" : "Send back"}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
