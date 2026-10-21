import { describe, expect, it } from "vitest";

import { createFakeStore, makeClassGroup, makeStudent } from "./fake-store.ts";

/**
 * The fake store is the only thing standing behind every handler test, so a
 * fake that is more forgiving than Postgres makes those tests prove less than
 * they look like they prove. These assert the places the two could drift.
 */
describe("fake store fidelity to the real schema", () => {
  it("nulls the student id on existing audit rows when a student is deleted", async () => {
    // The migration's FK is `on delete set null`, verified by execution in
    // schema.test.ts. The fake used to leave studentId intact, so a test
    // asserting "the audit trail still names the child" would have passed here
    // and been false in production.
    const store = createFakeStore([makeStudent({ id: "cohen" })]);
    await store.logEvent({
      studentId: "cohen",
      changedTo: "arrived",
      source: "voice",
      matchConfidence: 0.9,
      rawTranscript: "Cohen",
      carpoolId: null,
    });

    await store.removeStudents(["cohen"]);

    expect(store.events).toHaveLength(1);
    expect(store.events[0].studentId).toBeNull();
  });

  it("keeps the rest of the audit row intact after the student is gone", async () => {
    const store = createFakeStore([makeStudent({ id: "cohen" })]);
    await store.logEvent({
      studentId: "cohen",
      changedTo: "arrived",
      source: "voice",
      matchConfidence: 0.9,
      rawTranscript: "Cohen",
      carpoolId: null,
    });

    await store.removeStudents(["cohen"]);

    expect(store.events[0]).toMatchObject({
      changedTo: "arrived",
      source: "voice",
      rawTranscript: "Cohen",
    });
  });

  it("leaves other students' audit rows alone", async () => {
    const store = createFakeStore([
      makeStudent({ id: "cohen" }),
      makeStudent({ id: "ng" }),
    ]);
    await store.logEvent({
      studentId: "ng",
      changedTo: "arrived",
      source: "manual",
      matchConfidence: null,
      rawTranscript: null,
      carpoolId: null,
    });

    await store.removeStudents(["cohen"]);

    expect(store.events[0].studentId).toBe("ng");
  });

  it("setStatus is a compare-and-set, the way the neq clause is", async () => {
    const store = createFakeStore([
      makeStudent({ id: "cohen", status: "waiting" }),
    ]);

    await expect(store.setStatus("cohen", "arrived")).resolves.not.toBeNull();
    // Second confirmation of the same child changes nothing and returns null,
    // which is what makes the endpoint idempotent and the display flash once.
    await expect(store.setStatus("cohen", "arrived")).resolves.toBeNull();
  });
});

describe("fake store multi-class membership", () => {
  const k1 = makeClassGroup({ id: "k1", name: "K1", sort_order: 0 });
  const third = makeClassGroup({ id: "third", name: "3rd", sort_order: 1 });
  const fifth = makeClassGroup({ id: "fifth", name: "5th", sort_order: 2 });

  function build(students: ReturnType<typeof makeStudent>[]) {
    return createFakeStore(students, [], [k1, third, fifth]);
  }

  it("returns class names in class sort_order, whatever order they were given", async () => {
    const store = build([
      makeStudent({ id: "a", class_groups: ["5th", "K1"] }),
    ]);
    expect((await store.get("a"))?.class_groups).toEqual(["K1", "5th"]);
  });

  it("lists a student in any of the filtered classes", async () => {
    const store = build([
      makeStudent({ id: "a", class_groups: ["K1"] }),
      makeStudent({ id: "b", class_groups: ["3rd", "5th"] }),
      makeStudent({ id: "c", class_groups: [] }),
    ]);
    const ids = (await store.list({ classGroups: ["5th", "K1"] })).map(
      (s) => s.id,
    );
    expect(ids).toEqual(["a", "b"]);
    expect(await store.list({})).toHaveLength(3);
  });

  it("honours class_group_ids on create, update (omitted = untouched, [] = clear) and bulk create", async () => {
    const store = build([]);
    const created = await store.createStudent({
      first_name: "A",
      last_name: "B",
      aliases: [],
      class_group_ids: ["third", "k1"],
      carpool_id: null,
      parent1_name: null,
      parent2_name: null,
    });
    expect(created.class_groups).toEqual(["K1", "3rd"]);

    const untouched = await store.updateStudent(created.id, {
      first_name: "Z",
    });
    expect(untouched?.class_groups).toEqual(["K1", "3rd"]);

    const replaced = await store.updateStudent(created.id, {
      class_group_ids: ["fifth"],
    });
    expect(replaced?.class_groups).toEqual(["5th"]);

    const cleared = await store.updateStudent(created.id, {
      class_group_ids: [],
    });
    expect(cleared?.class_groups).toEqual([]);

    const [bulk] = await store.bulkCreateStudents([
      {
        first_name: "C",
        last_name: "D",
        aliases: [],
        class_group_ids: ["k1"],
        carpool_id: null,
        parent1_name: null,
        parent2_name: null,
      },
    ]);
    expect(bulk.class_groups).toEqual(["K1"]);
  });

  it("deleting a student removes only their links", async () => {
    const store = build([
      makeStudent({ id: "a", class_groups: ["K1"] }),
      makeStudent({ id: "b", class_groups: ["K1"] }),
    ]);
    await store.removeStudents(["a"]);
    expect(await store.countClassMembers()).toEqual({ k1: 1 });
  });

  describe("changeClassMembers", () => {
    it("adds and removes, reporting the member count afterward", async () => {
      const store = build([
        makeStudent({ id: "a", class_groups: ["K1"] }),
        makeStudent({ id: "b" }),
      ]);
      const outcome = await store.changeClassMembers("k1", ["b"], ["a"]);
      expect(outcome).toEqual({ memberCount: 1, ignoredIds: [] });
      expect((await store.get("b"))?.class_groups).toEqual(["K1"]);
      expect((await store.get("a"))?.class_groups).toEqual([]);
    });

    it("applies removes first, so an id in both lists ends as a member", async () => {
      const store = build([makeStudent({ id: "a", class_groups: ["K1"] })]);
      const outcome = await store.changeClassMembers("k1", ["a"], ["a"]);
      expect(outcome?.memberCount).toBe(1);
      expect((await store.get("a"))?.class_groups).toEqual(["K1"]);
    });

    it("reports ids not on the roster and treats re-adding a member as a no-op", async () => {
      const store = build([makeStudent({ id: "a", class_groups: ["K1"] })]);
      const outcome = await store.changeClassMembers(
        "k1",
        ["a", "ghost"],
        ["ghost2"],
      );
      expect(outcome).toEqual({
        memberCount: 1,
        ignoredIds: ["ghost", "ghost2"],
      });
    });

    it("returns null when the class is missing", async () => {
      const store = build([]);
      expect(await store.changeClassMembers("nope", [], [])).toBeNull();
    });
  });

  describe("removeClassGroup", () => {
    it("deletes a class with no members and reports nothing moved", async () => {
      const store = build([]);
      expect(await store.removeClassGroup("k1")).toEqual({
        status: "deleted",
        movedCount: 0,
      });
      expect(store.classGroupRows().map((g) => g.id)).toEqual([
        "third",
        "fifth",
      ]);
    });

    it("needs a decision when sole members exist, and deletes nothing", async () => {
      const store = build([
        makeStudent({
          id: "a",
          first_name: "Zed",
          last_name: "Adler",
          class_groups: ["K1"],
        }),
        makeStudent({
          id: "b",
          first_name: "Bo",
          last_name: "Baker",
          class_groups: ["K1", "3rd"],
        }),
      ]);
      expect(await store.removeClassGroup("k1")).toEqual({
        status: "needs-decision",
        memberCount: 2,
        soleMemberCount: 1,
        soleMembers: [{ id: "a", first_name: "Zed", last_name: "Adler" }],
      });
      expect(store.classGroupRows()).toHaveLength(3);
      expect((await store.get("a"))?.class_groups).toEqual(["K1"]);
    });

    it("caps the sole-member sample at 10 but counts them all", async () => {
      const students = Array.from({ length: 12 }, (_, i) =>
        makeStudent({
          id: `s${i}`,
          last_name: `L${String(i).padStart(2, "0")}`,
          class_groups: ["K1"],
        }),
      );
      const outcome = await build(students).removeClassGroup("k1");
      expect(outcome.status).toBe("needs-decision");
      if (outcome.status !== "needs-decision") return;
      expect(outcome.soleMemberCount).toBe(12);
      expect(outcome.soleMembers).toHaveLength(10);
    });

    it("deletes without a decision when every member is also in another class", async () => {
      const store = build([
        makeStudent({ id: "b", class_groups: ["K1", "3rd"] }),
      ]);
      expect(await store.removeClassGroup("k1")).toEqual({
        status: "deleted",
        movedCount: 0,
      });
      expect((await store.get("b"))?.class_groups).toEqual(["3rd"]);
    });

    it("force deletes and leaves sole members with no class (undefined force = false)", async () => {
      const store = build([makeStudent({ id: "a", class_groups: ["K1"] })]);
      expect(
        (await store.removeClassGroup("k1", { force: undefined })).status,
      ).toBe("needs-decision");
      expect(await store.removeClassGroup("k1", { force: true })).toEqual({
        status: "deleted",
        movedCount: 0,
      });
      expect((await store.get("a"))?.class_groups).toEqual([]);
    });

    it("moves every member, sole or not, to the target; movedCount includes those already there", async () => {
      const store = build([
        makeStudent({ id: "a", class_groups: ["K1"] }),
        makeStudent({ id: "b", class_groups: ["K1", "3rd"] }),
        makeStudent({ id: "c", class_groups: ["K1", "5th"] }),
      ]);
      expect(
        await store.removeClassGroup("k1", { moveToClassId: "third" }),
      ).toEqual({ status: "deleted", movedCount: 3 });
      expect((await store.get("a"))?.class_groups).toEqual(["3rd"]);
      expect((await store.get("b"))?.class_groups).toEqual(["3rd"]);
      expect((await store.get("c"))?.class_groups).toEqual(["3rd", "5th"]);
      expect(await store.countClassMembers()).toEqual({ third: 3, fifth: 1 });
    });

    it("reports not-found and bad-target without changing anything", async () => {
      const store = build([makeStudent({ id: "a", class_groups: ["K1"] })]);
      expect(await store.removeClassGroup("nope")).toEqual({
        status: "not-found",
      });
      expect(
        await store.removeClassGroup("k1", { moveToClassId: "k1" }),
      ).toEqual({ status: "bad-target" });
      expect(
        await store.removeClassGroup("k1", { moveToClassId: "nope" }),
      ).toEqual({ status: "bad-target" });
      expect(store.classGroupRows()).toHaveLength(3);
      expect((await store.get("a"))?.class_groups).toEqual(["K1"]);
    });
  });
});
