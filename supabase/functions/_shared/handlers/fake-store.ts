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
} from "../ports.ts";

export interface FakeStore extends RosterStore {
  /** Every event the handlers logged, in order. */
  events: StatusEventInput[];
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
  const events: StatusEventInput[] = [];

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
  };
}
