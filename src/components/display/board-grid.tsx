import { Fragment } from "react";

import { SectionHeading } from "@/components/display/section-heading";
import { StudentTile } from "@/components/display/student-tile";
import type { DisplaySection } from "@/lib/display-sections";

/**
 * The grid itself. Sort order is stable across a status change -- always by
 * name, within a section, never "waiting first" -- so an arrival is a colour
 * flip in place, not a reshuffle that makes the person a teacher just called
 * for jump somewhere else on the screen mid-glance.
 *
 * Section headings only render when more than one section is on screen: a
 * teacher who has filtered down to their own class needs no heading
 * repeating what the filter chip above already says.
 */
export function BoardGrid({
  sections,
  flashingIds,
}: {
  sections: DisplaySection[];
  flashingIds: ReadonlySet<string>;
}) {
  const showHeadings = sections.length > 1;

  return (
    <ul
      className="grid flex-1 gap-3 overflow-y-auto p-4 sm:gap-4 sm:p-6"
      style={{
        gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
        // Rows stretch to fill the board rather than stacking at the top.
        //
        // This screen is a wall-mounted TV read from across a room, so unused
        // vertical space is not neutral -- it is height the names could have
        // been using. With fixed-height rows a 26-child roster left roughly
        // 40% of a 1080p screen as empty black while the surnames sat at 30px.
        // The 7rem floor keeps tiles legible when a roster is long enough to
        // scroll, where `1fr` would otherwise crush them.
        gridAutoRows: "minmax(7rem, 1fr)",
      }}
    >
      {sections.map((section) => (
        <Fragment key={section.key}>
          {showHeadings && (
            <li className="contents">
              <SectionHeading section={section} />
            </li>
          )}
          {section.students.map((student) => (
            <StudentTile
              key={student.id}
              student={student}
              flashing={flashingIds.has(student.id)}
            />
          ))}
        </Fragment>
      ))}
    </ul>
  );
}
