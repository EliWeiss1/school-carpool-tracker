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
      className="grid flex-1 content-start gap-3 overflow-y-auto p-4 sm:gap-4 sm:p-6"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}
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
