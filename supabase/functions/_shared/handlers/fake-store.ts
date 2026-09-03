/**
 * An in-memory RosterStore for the handler tests.
 *
 * Test-only. No Edge Function entrypoint imports this file, so Deno never
 * bundles it; it lives beside the handlers rather than in a test directory
 * because all three handler suites share it.
 */

import type {
  RosterFilter,
  RosterStore,
  StatusEventInput,
  StudentRow,
  StudentStatus,
  StudentWriteInput,
} from "../ports.ts";

/**
 * An audit row as it exists AFTER the roster row it points at may have been
 * deleted -- `status_events.student_id` is nullable and the FK is
 * `on delete set null`, so the event outlives the student without naming them.
 */
export type LoggedEvent = Omit<StatusEventInput, "studentId"> & {
  studentId: string | null;
};

export interface FakeStore extends RosterStore {
  /** Every event the handlers logged, in order. */
  events: LoggedEvent[];
  rows(): StudentRow[];
  row(id: string): StudentRow | undefined;
}

let counter = 0;

export function makeStudent(overrides: Partial<StudentRow> = {}): StudentRow {
  counter++;
  return {
    id: `student-${counter}`,
    first_name: "Test",
    last_name: `Name${counter}`,
    aliases: [],
    grade: null,
    class_group: null,
    status: "waiting",
    arrived_at: null,
    updated_at: "2026-09-02T12:00:00.000Z",
    ...overrides,
  };
}

export function createFakeStore(initial: StudentRow[]): FakeStore {
  const students = initial.map((student) => ({ ...student }));
  const events: LoggedEvent[] = [];

  return {
    events,
    rows: () => students.map((student) => ({ ...student })),
    row: (id) => students.find((student) => student.id === id),

    list(filter: RosterFilter): Promise<StudentRow[]> {
      return Promise.resolve(
        students
          .filter((student) => !filter.grade || student.grade === filter.grade)
          .filter(
            (student) =>
              !filter.classGroup || student.class_group === filter.classGroup,
          )
          .map((student) => ({ ...student })),
      );
    },

    get(id: string): Promise<StudentRow | null> {
      const found = students.find((student) => student.id === id);
      return Promise.resolve(found ? { ...found } : null);
    },

    setStatus(id: string, status: StudentStatus): Promise<StudentRow | null> {
      const found = students.find((student) => student.id === id);
      // Mirrors the conditional UPDATE: no row matches when the student is
      // already in the requested status, so nothing changes and nobody is told.
      if (!found || found.status === status) return Promise.resolve(null);

      found.status = status;
      found.arrived_at =
        status === "arrived" ? "2026-09-02T14:30:00.000Z" : null;
      found.updated_at = "2026-09-02T14:30:00.000Z";
      return Promise.resolve({ ...found });
    },

    logEvent(event: StatusEventInput): Promise<boolean> {
      events.push(event);
      return Promise.resolve(true);
    },

    createStudent(input: StudentWriteInput): Promise<StudentRow> {
      counter++;
      const student: StudentRow = {
        id: `student-${counter}`,
        first_name: input.first_name,
        last_name: input.last_name,
        aliases: [...input.aliases],
        grade: input.grade,
        class_group: input.class_group,
        status: "waiting",
        arrived_at: null,
        updated_at: "2026-09-02T12:00:00.000Z",
      };
      students.push(student);
      return Promise.resolve({ ...student });
    },

    updateStudent(
      id: string,
      patch: Partial<StudentWriteInput>,
    ): Promise<StudentRow | null> {
      const found = students.find((student) => student.id === id);
      if (!found) return Promise.resolve(null);

      if (patch.first_name !== undefined) found.first_name = patch.first_name;
      if (patch.last_name !== undefined) found.last_name = patch.last_name;
      if (patch.aliases !== undefined) found.aliases = [...patch.aliases];
      if (patch.grade !== undefined) found.grade = patch.grade;
      if (patch.class_group !== undefined)
        found.class_group = patch.class_group;
      found.updated_at = "2026-09-02T14:30:00.000Z";

      return Promise.resolve({ ...found });
    },

    removeStudent(id: string): Promise<boolean> {
      const index = students.findIndex((student) => student.id === id);
      if (index === -1) return Promise.resolve(false);
      students.splice(index, 1);

      // The FK really is `on delete set null` (schema.test.ts proves it by
      // execution), so the audit row survives the student but stops naming
      // them. The fake used to leave studentId intact, which is the more
      // forgiving behaviour -- and a fake that is kinder than Postgres lets a
      // handler test pass on something production would not do.
      for (let i = 0; i < events.length; i++) {
        if (events[i].studentId === id) events[i].studentId = null;
      }
      return Promise.resolve(true);
    },

    bulkCreateStudents(inputs: StudentWriteInput[]): Promise<StudentRow[]> {
      const created = inputs.map((input) => {
        counter++;
        const student: StudentRow = {
          id: `student-${counter}`,
          first_name: input.first_name,
          last_name: input.last_name,
          aliases: [...input.aliases],
          grade: input.grade,
          class_group: input.class_group,
          status: "waiting",
          arrived_at: null,
          updated_at: "2026-09-02T12:00:00.000Z",
        };
        students.push(student);
        return { ...student };
      });
      return Promise.resolve(created);
    },

    resetAllToWaiting(): Promise<StudentRow[]> {
      const changed: StudentRow[] = [];
      for (const student of students) {
        if (student.status !== "arrived") continue;
        student.status = "waiting";
        student.arrived_at = null;
        student.updated_at = "2026-09-02T14:30:00.000Z";
        changed.push({ ...student });
      }
      return Promise.resolve(changed);
    },
  };
}
