/**
 * An in-memory RosterStore for the handler tests.
 *
 * Test-only. No Edge Function entrypoint imports this file, so Deno never
 * bundles it; it lives beside the handlers rather than in a test directory
 * because all three handler suites share it.
 */

import type {
  CarpoolRow,
  CarpoolWriteInput,
  ClassGroupRow,
  ChangeMembersOutcome,
  ClassGroupWriteInput,
  RemoveClassGroupOutcome,
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
  carpoolRows(): CarpoolRow[];
  classGroupRows(): ClassGroupRow[];
}

let counter = 0;
let carpoolCounter = 0;
let classGroupCounter = 0;

export function makeStudent(overrides: Partial<StudentRow> = {}): StudentRow {
  counter++;
  return {
    id: `student-${counter}`,
    first_name: "Test",
    last_name: `Name${counter}`,
    aliases: [],
    class_groups: [],
    status: "waiting",
    arrived_at: null,
    updated_at: "2026-09-02T12:00:00.000Z",
    carpool_id: null,
    parent1_name: null,
    parent2_name: null,
    ...overrides,
  };
}

export function makeCarpool(overrides: Partial<CarpoolRow> = {}): CarpoolRow {
  carpoolCounter++;
  return {
    id: `carpool-${carpoolCounter}`,
    name: `Carpool ${carpoolCounter}`,
    aliases: [],
    created_at: "2026-09-02T12:00:00.000Z",
    updated_at: "2026-09-02T12:00:00.000Z",
    ...overrides,
  };
}

export function makeClassGroup(
  overrides: Partial<ClassGroupRow> = {},
): ClassGroupRow {
  classGroupCounter++;
  return {
    id: `class-${classGroupCounter}`,
    name: `Class ${classGroupCounter}`,
    sort_order: classGroupCounter,
    ...overrides,
  };
}

export function createFakeStore(
  initial: StudentRow[],
  initialCarpools: CarpoolRow[] = [],
  initialClassGroups: ClassGroupRow[] = [],
): FakeStore {
  const students = initial.map((student) => ({ ...student }));
  const carpools = initialCarpools.map((carpool) => ({ ...carpool }));
  const classGroups = initialClassGroups.map((group) => ({ ...group }));
  const events: LoggedEvent[] = [];

  // student id -> ids of the classes they are in: the in-memory twin of the
  // public.student_classes junction table. The `class_groups` names on a
  // StudentRow are always derived from this, never stored.
  const links = new Map<string, Set<string>>();
  const linksFor = (studentId: string): Set<string> => {
    let set = links.get(studentId);
    if (!set) {
      set = new Set<string>();
      links.set(studentId, set);
    }
    return set;
  };

  // Seed rows name their classes. A name with no matching class is created on
  // the spot (appended in sort order) so a test can say `class_groups: ["3rd"]`
  // without also declaring the class list.
  for (const student of students) {
    for (const name of student.class_groups) {
      let group = classGroups.find((g) => g.name === name);
      if (!group) {
        classGroupCounter++;
        group = {
          id: `class-${classGroupCounter}`,
          name,
          sort_order:
            classGroups.reduce((max, g) => Math.max(max, g.sort_order), -1) + 1,
        };
        classGroups.push(group);
      }
      linksFor(student.id).add(group.id);
    }
  }

  /** A copy of the row with `class_groups` derived, in class sort_order. */
  const snap = (student: StudentRow): StudentRow => ({
    ...student,
    class_groups: classGroups
      .filter((group) => links.get(student.id)?.has(group.id))
      // Ties broken by name, the same rule as class-embed.ts flattenClassNames.
      .sort(
        (a, b) =>
          a.sort_order - b.sort_order ||
          (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
      )
      .map((group) => group.name),
  });

  /**
   * Mirrors the foreign key on student_classes.class_group_id: a write naming a
   * class that is not there fails, and the real store maps that failure to this
   * same sentence. Checked before anything is written, so a failed write
   * changes nothing -- the real insert is atomic too.
   */
  const assertKnownClasses = (classIds: readonly string[]): void => {
    const known = new Set(classGroups.map((group) => group.id));
    if (classIds.some((classId) => !known.has(classId))) {
      throw new Error(
        "One of those classes no longer exists. Reload the page and try again.",
      );
    }
  };

  /** Replaces a student's classes. Callers have run `assertKnownClasses`. */
  const setLinks = (studentId: string, classIds: readonly string[]): void => {
    links.set(studentId, new Set(classIds));
  };

  // Matches the cap in public.remove_class_group().
  const MEMBER_SAMPLE_SIZE = 10;

  return {
    events,
    rows: () => students.map(snap),
    row: (id) => {
      const found = students.find((student) => student.id === id);
      return found ? snap(found) : undefined;
    },
    carpoolRows: () => carpools.map((carpool) => ({ ...carpool })),
    classGroupRows: () => classGroups.map((group) => ({ ...group })),

    list(filter: RosterFilter): Promise<StudentRow[]> {
      const wanted = filter.classGroups ?? [];
      return Promise.resolve(
        students
          .map(snap)
          .filter(
            (student) =>
              wanted.length === 0 ||
              student.class_groups.some((name) => wanted.includes(name)),
          ),
      );
    },

    get(id: string): Promise<StudentRow | null> {
      const found = students.find((student) => student.id === id);
      return Promise.resolve(found ? snap(found) : null);
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
      return Promise.resolve(snap(found));
    },

    setStatusMany(ids: string[], status: StudentStatus): Promise<StudentRow[]> {
      const changed: StudentRow[] = [];
      for (const id of ids) {
        const found = students.find((student) => student.id === id);
        if (!found || found.status === status) continue;
        found.status = status;
        found.arrived_at =
          status === "arrived" ? "2026-09-02T14:30:00.000Z" : null;
        found.updated_at = "2026-09-02T14:30:00.000Z";
        changed.push(snap(found));
      }
      return Promise.resolve(changed);
    },

    logEvent(event: StatusEventInput): Promise<boolean> {
      events.push(event);
      return Promise.resolve(true);
    },

    async createStudent(input: StudentWriteInput): Promise<StudentRow> {
      assertKnownClasses(input.class_group_ids);
      counter++;
      const student: StudentRow = {
        id: `student-${counter}`,
        first_name: input.first_name,
        last_name: input.last_name,
        aliases: [...input.aliases],
        class_groups: [],
        status: "waiting",
        arrived_at: null,
        updated_at: "2026-09-02T12:00:00.000Z",
        carpool_id: input.carpool_id,
        parent1_name: input.parent1_name,
        parent2_name: input.parent2_name,
      };
      students.push(student);
      setLinks(student.id, input.class_group_ids);
      return Promise.resolve(snap(student));
    },

    async updateStudent(
      id: string,
      patch: Partial<StudentWriteInput>,
    ): Promise<StudentRow | null> {
      const found = students.find((student) => student.id === id);
      if (!found) return Promise.resolve(null);
      if (patch.class_group_ids !== undefined)
        assertKnownClasses(patch.class_group_ids);

      if (patch.first_name !== undefined) found.first_name = patch.first_name;
      if (patch.last_name !== undefined) found.last_name = patch.last_name;
      if (patch.aliases !== undefined) found.aliases = [...patch.aliases];
      if (patch.class_group_ids !== undefined)
        setLinks(found.id, patch.class_group_ids);
      if (patch.carpool_id !== undefined) found.carpool_id = patch.carpool_id;
      if (patch.parent1_name !== undefined)
        found.parent1_name = patch.parent1_name;
      if (patch.parent2_name !== undefined)
        found.parent2_name = patch.parent2_name;
      found.updated_at = "2026-09-02T14:30:00.000Z";

      return Promise.resolve(snap(found));
    },

    removeStudents(ids: string[]): Promise<string[]> {
      const removed: string[] = [];
      for (const id of ids) {
        const index = students.findIndex((student) => student.id === id);
        if (index === -1) continue;
        students.splice(index, 1);
        links.delete(id);
        removed.push(id);

        // The FK really is `on delete set null` (schema.test.ts proves it by
        // execution), so the audit row survives the student but stops naming
        // them. The fake used to leave studentId intact, which is the more
        // forgiving behaviour -- and a fake that is kinder than Postgres lets
        // a handler test pass on something production would not do.
        for (let i = 0; i < events.length; i++) {
          if (events[i].studentId === id) events[i].studentId = null;
        }
      }
      return Promise.resolve(removed);
    },

    async bulkCreateStudents(
      inputs: StudentWriteInput[],
    ): Promise<StudentRow[]> {
      // All or nothing, like the real bulk insert.
      for (const input of inputs) assertKnownClasses(input.class_group_ids);
      const created = inputs.map((input) => {
        counter++;
        const student: StudentRow = {
          id: `student-${counter}`,
          first_name: input.first_name,
          last_name: input.last_name,
          aliases: [...input.aliases],
          class_groups: [],
          status: "waiting",
          arrived_at: null,
          updated_at: "2026-09-02T12:00:00.000Z",
          carpool_id: input.carpool_id,
          parent1_name: input.parent1_name,
          parent2_name: input.parent2_name,
        };
        students.push(student);
        setLinks(student.id, input.class_group_ids);
        return snap(student);
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
        changed.push(snap(student));
      }
      return Promise.resolve(changed);
    },

    listCarpools(): Promise<CarpoolRow[]> {
      return Promise.resolve(carpools.map((carpool) => ({ ...carpool })));
    },

    createCarpool(input: CarpoolWriteInput): Promise<CarpoolRow> {
      carpoolCounter++;
      const carpool: CarpoolRow = {
        id: `carpool-${carpoolCounter}`,
        name: input.name,
        aliases: [...input.aliases],
        created_at: "2026-09-02T12:00:00.000Z",
        updated_at: "2026-09-02T12:00:00.000Z",
      };
      carpools.push(carpool);
      return Promise.resolve({ ...carpool });
    },

    updateCarpool(
      id: string,
      patch: Partial<CarpoolWriteInput>,
    ): Promise<CarpoolRow | null> {
      const found = carpools.find((carpool) => carpool.id === id);
      if (!found) return Promise.resolve(null);

      if (patch.name !== undefined) found.name = patch.name;
      if (patch.aliases !== undefined) found.aliases = [...patch.aliases];
      found.updated_at = "2026-09-02T14:30:00.000Z";

      return Promise.resolve({ ...found });
    },

    removeCarpool(id: string): Promise<boolean> {
      const index = carpools.findIndex((carpool) => carpool.id === id);
      if (index === -1) return Promise.resolve(false);
      carpools.splice(index, 1);

      // Mirrors the FK's `on delete set null`: members survive, unlinked.
      for (const student of students) {
        if (student.carpool_id === id) student.carpool_id = null;
      }
      return Promise.resolve(true);
    },

    setCarpoolMembers(
      carpoolId: string | null,
      studentIds: string[],
    ): Promise<StudentRow[]> {
      const updated: StudentRow[] = [];
      for (const id of studentIds) {
        const found = students.find((student) => student.id === id);
        if (!found) continue;
        found.carpool_id = carpoolId;
        found.updated_at = "2026-09-02T14:30:00.000Z";
        updated.push(snap(found));
      }
      return Promise.resolve(updated);
    },

    listClassGroups(): Promise<ClassGroupRow[]> {
      return Promise.resolve(
        [...classGroups]
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((group) => ({ ...group })),
      );
    },

    createClassGroup(input: ClassGroupWriteInput): Promise<ClassGroupRow> {
      classGroupCounter++;
      const nextOrder =
        classGroups.reduce((max, g) => Math.max(max, g.sort_order), -1) + 1;
      const group: ClassGroupRow = {
        id: `class-${classGroupCounter}`,
        name: input.name,
        sort_order: nextOrder,
      };
      classGroups.push(group);
      return Promise.resolve({ ...group });
    },

    removeClassGroup(
      id: string,
      options: { moveToClassId?: string; force?: boolean } = {},
    ): Promise<RemoveClassGroupOutcome> {
      const index = classGroups.findIndex((group) => group.id === id);
      if (index === -1) return Promise.resolve({ status: "not-found" });

      const target = options.moveToClassId;
      if (
        target !== undefined &&
        (target === id || !classGroups.some((group) => group.id === target))
      ) {
        return Promise.resolve({ status: "bad-target" });
      }

      const members = students.filter((student) =>
        links.get(student.id)?.has(id),
      );

      const finish = (movedCount: number): RemoveClassGroupOutcome => {
        classGroups.splice(
          classGroups.findIndex((group) => group.id === id),
          1,
        );
        for (const set of links.values()) set.delete(id);
        return { status: "deleted", movedCount };
      };

      // Every member moves, sole or not -- movedCount is the size of the
      // class, including students who were already in the target.
      if (target !== undefined) {
        for (const member of members) linksFor(member.id).add(target);
        return Promise.resolve(finish(members.length));
      }

      if (options.force !== true) {
        // A "sole member" is in no other class; someone in two is never one.
        const sole = members
          .filter((member) => (links.get(member.id)?.size ?? 0) <= 1)
          .sort(
            (a, b) =>
              a.last_name.localeCompare(b.last_name) ||
              a.first_name.localeCompare(b.first_name) ||
              a.id.localeCompare(b.id),
          );
        if (sole.length > 0) {
          return Promise.resolve({
            status: "needs-decision",
            memberCount: members.length,
            soleMemberCount: sole.length,
            soleMembers: sole.slice(0, MEMBER_SAMPLE_SIZE).map((member) => ({
              id: member.id,
              first_name: member.first_name,
              last_name: member.last_name,
            })),
          });
        }
      }

      return Promise.resolve(finish(0));
    },

    changeClassMembers(
      classGroupId: string,
      addIds: string[],
      removeIds: string[],
    ): Promise<ChangeMembersOutcome | null> {
      if (!classGroups.some((group) => group.id === classGroupId)) {
        return Promise.resolve(null);
      }
      const onRoster = (studentId: string): boolean =>
        students.some((student) => student.id === studentId);

      const ignored = [...new Set([...addIds, ...removeIds])]
        .filter((studentId) => !onRoster(studentId))
        .sort();

      // Removes first, so an id in both lists ends up a member.
      for (const studentId of removeIds) {
        links.get(studentId)?.delete(classGroupId);
      }
      for (const studentId of addIds) {
        if (onRoster(studentId)) linksFor(studentId).add(classGroupId);
      }

      let memberCount = 0;
      for (const set of links.values()) {
        if (set.has(classGroupId)) memberCount++;
      }
      return Promise.resolve({ memberCount, ignoredIds: ignored });
    },

    countClassMembers(): Promise<Record<string, number>> {
      const counts: Record<string, number> = {};
      for (const set of links.values()) {
        for (const classId of set) counts[classId] = (counts[classId] ?? 0) + 1;
      }
      return Promise.resolve(counts);
    },

    reorderClassGroups(orderedIds: string[]): Promise<ClassGroupRow[]> {
      orderedIds.forEach((id, index) => {
        const found = classGroups.find((group) => group.id === id);
        if (found) found.sort_order = index;
      });
      return Promise.resolve(
        [...classGroups]
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((group) => ({ ...group })),
      );
    },
  };
}
