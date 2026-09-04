import { SectionHeading } from "@/components/display/section-heading";
import { StudentTile } from "@/components/display/student-tile";
import type { DisplaySection } from "@/lib/display-sections";

/**
 * The grid itself. Sort order is stable across a status change -- always by
 * name, within a section, never "waiting first" -- so an arrival is a colour
 * flip in place, not a reshuffle that makes the person a teacher just called
 * for jump somewhere else on the screen mid-glance.
 *
 * Each section owns its own tile grid rather than sharing one flat grid with
 * every other section. A single flat grid forced every implicit row --
 * including a section heading's -- to the same `grid-auto-rows` height as a
 * tile row, which stretched each heading into several inches of near-empty
 * space at 105 students. Splitting per section fixes that and, as a side
 * effect, is what makes the "all classes" view dense: seven sections stack at
 * their own natural height instead of every row being forced equally tall.
 *
 * The one place rows still stretch to fill the screen is the common case of a
 * single visible section (the class filter's whole point) -- `flex-1` there
 * keeps the pre-carpools behaviour of a filtered class's tiles growing to use
 * the full board rather than clumping at the top.
 */
export function BoardGrid({
  sections,
  flashingIds,
}: {
  sections: DisplaySection[];
  flashingIds: ReadonlySet<string>;
}) {
  const showHeadings = sections.length > 1;
  const singleSection = sections.length === 1;

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4 sm:gap-4 sm:p-6">
      {sections.map((section) => (
        <section
          key={section.key}
          className={singleSection ? "flex flex-1 flex-col" : undefined}
        >
          {showHeadings && <SectionHeading section={section} />}
          <ul
            className={
              singleSection
                ? "grid flex-1 gap-2 sm:gap-3"
                : "grid gap-2 sm:gap-3"
            }
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))",
              // A floor, not a fixed size: with 105 students on screen at
              // once, rows stay legible but small; a single filtered class
              // still grows to fill the board via the section's own flex-1.
              gridAutoRows: "minmax(4.5rem, 1fr)",
            }}
          >
            {section.students.map((student) => (
              <StudentTile
                key={student.id}
                student={student}
                flashing={flashingIds.has(student.id)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
