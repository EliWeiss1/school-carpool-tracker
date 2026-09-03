import { StudentTile } from "@/components/display/student-tile";
import type { Student } from "@/types/db";

/**
 * The grid itself. Sort order is stable across a status change -- always by
 * name, never "waiting first" -- so an arrival is a colour flip in place, not
 * a reshuffle that makes the person a teacher just called for jump somewhere
 * else on the screen mid-glance.
 */
export function BoardGrid({
  students,
  flashingIds,
}: {
  students: Student[];
  flashingIds: ReadonlySet<string>;
}) {
  return (
    <ul
      className="grid flex-1 gap-3 overflow-y-auto p-4 sm:gap-4 sm:p-6"
      style={{
        gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
        // Rows stretch to fill the board rather than stacking at the top.
        //
        // This screen is a wall-mounted TV read from across a room, so unused
        // vertical space is not neutral -- it is height the names could have
        // been using. With fixed-height rows a 26-child roster left roughly
        // 40% of a 1080p screen as empty black while the surnames sat at 30px.
        // The 9rem floor keeps tiles legible when a roster is long enough to
        // scroll, where `1fr` would otherwise crush them.
        gridAutoRows: "minmax(9rem, 1fr)",
      }}
    >
      {students.map((student) => (
        <StudentTile
          key={student.id}
          student={student}
          flashing={flashingIds.has(student.id)}
        />
      ))}
    </ul>
  );
}
