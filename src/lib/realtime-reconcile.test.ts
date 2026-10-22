import { describe, expect, it } from "vitest";

import { applySnapshot, reconcile, type DisplayRoster } from "./realtime-reconcile";
import type { Student, StudentWithClasses } from "@/types/db";

/** Minimal, valid `Student` row — only the fields a given test cares about differ. */
function student(overrides: Partial<StudentWithClasses> & Pick<StudentWithClasses, "id">): StudentWithClasses {
  return {
    first_name: "Jonah",
    last_name: "Smith",
    aliases: [],
    class_groups: ["K1"],
    status: "waiting",
    arrived_at: null,
    updated_at: "2026-09-02T12:00:00.000Z",
    carpool_id: null,
    ...overrides,
  };
}

/** What a realtime payload carries: the row, with no class membership. */
function plain(row: StudentWithClasses): Student {
  const { class_groups, ...rest } = row;
  void class_groups;
  return rest;
}

describe("reconcile", () => {
  it("adds a new student on INSERT", () => {
    const row = student({ id: "s1", class_groups: [] });
    const result = reconcile(
      {},
      { eventType: "INSERT", new: plain(row), old: null },
    );

    expect(result.roster).toEqual({ s1: row });
    expect(result.arrivals).toEqual([]);
  });

  it("flashes a genuine waiting -> arrived transition", () => {
    const before: DisplayRoster = {
      s1: student({ id: "s1", status: "waiting", updated_at: "2026-09-02T12:00:00.000Z" }),
    };
    const after = student({
      id: "s1",
      status: "arrived",
      arrived_at: "2026-09-02T12:05:00.000Z",
      updated_at: "2026-09-02T12:05:00.000Z",
    });

    const result = reconcile(before, {
      eventType: "UPDATE",
      new: after,
      old: before.s1,
    });

    expect(result.roster.s1.status).toBe("arrived");
    expect(result.arrivals).toEqual(["s1"]);
  });

  it("stays silent on a rename that does not touch status", () => {
    const before: DisplayRoster = {
      s1: student({ id: "s1", first_name: "Jon", status: "waiting" }),
    };
    const after = student({
      id: "s1",
      first_name: "Jonathan",
      status: "waiting",
      updated_at: "2026-09-02T12:01:00.000Z",
    });

    const result = reconcile(before, {
      eventType: "UPDATE",
      new: after,
      old: before.s1,
    });

    expect(result.roster.s1.first_name).toBe("Jonathan");
    expect(result.arrivals).toEqual([]);
  });

  it("stays silent on an undo (arrived -> waiting)", () => {
    const before: DisplayRoster = {
      s1: student({ id: "s1", status: "arrived", updated_at: "2026-09-02T12:05:00.000Z" }),
    };
    const after = student({
      id: "s1",
      status: "waiting",
      arrived_at: null,
      updated_at: "2026-09-02T12:06:00.000Z",
    });

    const result = reconcile(before, {
      eventType: "UPDATE",
      new: after,
      old: before.s1,
    });

    expect(result.roster.s1.status).toBe("waiting");
    expect(result.arrivals).toEqual([]);
  });

  it("an UPDATE payload keeps the held class_groups", () => {
    // A realtime payload on `students` carries no membership (that lives in
    // student_classes), so the held row's classes must survive the merge.
    const before: DisplayRoster = {
      s1: student({ id: "s1", class_groups: ["K1", "2nd"] }),
    };
    const after = plain(
      student({
        id: "s1",
        first_name: "Jonathan",
        updated_at: "2026-09-02T12:02:00.000Z",
      }),
    );

    const result = reconcile(before, {
      eventType: "UPDATE",
      new: after,
      old: plain(before.s1),
    });

    expect(result.roster.s1.first_name).toBe("Jonathan");
    expect(result.roster.s1.class_groups).toEqual(["K1", "2nd"]);
    expect(result.arrivals).toEqual([]);
  });

  it("an INSERT starts with []", () => {
    const result = reconcile(
      {},
      { eventType: "INSERT", new: plain(student({ id: "s1" })), old: null },
    );
    expect(result.roster.s1.class_groups).toEqual([]);
  });

  it("a stale payload is still discarded", () => {
    const held = student({
      id: "s1",
      class_groups: ["K1", "2nd"],
      status: "arrived",
      updated_at: "2026-09-02T12:05:00.000Z",
    });
    const result = reconcile(
      { s1: held },
      {
        eventType: "UPDATE",
        new: plain(
          student({
            id: "s1",
            status: "waiting",
            updated_at: "2026-09-02T12:00:00.000Z",
          }),
        ),
        old: null,
      },
    );
    expect(result.roster.s1).toBe(held);
    expect(result.arrivals).toEqual([]);
  });

  it("an arrival for a two-class student reports one arrival id", () => {
    const before: DisplayRoster = {
      s1: student({ id: "s1", class_groups: ["K1", "2nd"] }),
    };
    const result = reconcile(before, {
      eventType: "UPDATE",
      new: plain(
        student({
          id: "s1",
          status: "arrived",
          updated_at: "2026-09-02T12:05:00.000Z",
        }),
      ),
      old: plain(before.s1),
    });
    expect(result.arrivals).toEqual(["s1"]);
    expect(result.roster.s1.class_groups).toEqual(["K1", "2nd"]);
  });

  it("discards an out-of-order payload that is not strictly newer", () => {
    const current = student({
      id: "s1",
      status: "arrived",
      updated_at: "2026-09-02T12:05:00.000Z",
    });
    const before: DisplayRoster = { s1: current };

    // A stale UPDATE claiming "waiting" arrives late, from before the arrival.
    const stale = student({
      id: "s1",
      status: "waiting",
      updated_at: "2026-09-02T12:04:00.000Z",
    });

    const result = reconcile(before, {
      eventType: "UPDATE",
      new: stale,
      old: null,
    });

    // The already-held, newer "arrived" row must survive untouched.
    expect(result.roster.s1).toBe(current);
    expect(result.arrivals).toEqual([]);
  });

  it("discards a redelivered payload with an identical timestamp (no double flash)", () => {
    const current = student({
      id: "s1",
      status: "arrived",
      updated_at: "2026-09-02T12:05:00.000Z",
    });
    const before: DisplayRoster = { s1: current };

    const redelivered = student({
      id: "s1",
      status: "arrived",
      updated_at: "2026-09-02T12:05:00.000Z",
    });

    const result = reconcile(before, {
      eventType: "UPDATE",
      new: redelivered,
      old: null,
    });

    expect(result.roster).toBe(before);
    expect(result.arrivals).toEqual([]);
  });

  it("removes a student on DELETE", () => {
    const before: DisplayRoster = { s1: student({ id: "s1" }) };
    const result = reconcile(before, {
      eventType: "DELETE",
      new: null,
      old: before.s1,
    });

    expect(result.roster).toEqual({});
    expect(result.arrivals).toEqual([]);
  });

  it("no-ops a DELETE for a student it never held", () => {
    const before: DisplayRoster = {};
    const result = reconcile(before, {
      eventType: "DELETE",
      new: null,
      old: student({ id: "ghost" }),
    });

    expect(result.roster).toEqual({});
    expect(result.arrivals).toEqual([]);
  });

  it("never flashes on INSERT of a student who is already arrived", () => {
    const row = student({ id: "s1", status: "arrived" });
    const result = reconcile({}, { eventType: "INSERT", new: row, old: null });
    expect(result.arrivals).toEqual([]);
  });
});

describe("applySnapshot", () => {
  it("seeds an empty roster from a fetch", () => {
    const rows = [student({ id: "s1" }), student({ id: "s2", status: "arrived" })];
    const roster = applySnapshot({}, rows);

    expect(Object.keys(roster).sort()).toEqual(["s1", "s2"]);
  });

  it("never produces an arrival, even for a snapshot row that is already arrived", () => {
    // applySnapshot has no arrivals return value at all -- structurally
    // impossible to flash from the initial load or a reconnect refetch.
    const rows = [student({ id: "s1", status: "arrived" })];
    const roster = applySnapshot({}, rows);
    expect(roster.s1.status).toBe("arrived");
  });

  it("does not clobber a fresher row already held locally from a realtime event that beat the fetch", () => {
    const fresh = student({
      id: "s1",
      status: "arrived",
      updated_at: "2026-09-02T12:05:00.000Z",
    });
    const before: DisplayRoster = { s1: fresh };

    const staleSnapshotRow = student({
      id: "s1",
      status: "waiting",
      updated_at: "2026-09-02T12:00:00.000Z",
    });

    const roster = applySnapshot(before, [staleSnapshotRow]);
    expect(roster.s1).toBe(fresh);
  });

  it("never removes a locally-held student who is simply absent from the snapshot rows", () => {
    // Only a DELETE payload removes a student -- a student inserted by realtime
    // after the snapshot query ran but before its response landed must survive.
    const before: DisplayRoster = { s1: student({ id: "s1" }) };
    const roster = applySnapshot(before, []);
    expect(roster).toEqual(before);
  });

  it("takes class_groups from the snapshot even when the held row is fresher", () => {
    const held = student({
      id: "s1",
      status: "arrived",
      class_groups: ["K1"],
      updated_at: "2026-09-02T12:05:00.000Z",
    });
    const snapshotRow = student({
      id: "s1",
      status: "waiting",
      class_groups: ["K1", "2nd"],
      updated_at: "2026-09-02T12:00:00.000Z",
    });

    const roster = applySnapshot({ s1: held }, [snapshotRow]);

    expect(roster.s1.class_groups).toEqual(["K1", "2nd"]);
  });

  it("still never lowers a fresher status", () => {
    const held = student({
      id: "s1",
      status: "arrived",
      arrived_at: "2026-09-02T12:05:00.000Z",
      updated_at: "2026-09-02T12:05:00.000Z",
    });
    const snapshotRow = student({
      id: "s1",
      status: "waiting",
      class_groups: ["3rd"],
      updated_at: "2026-09-02T12:00:00.000Z",
    });

    const roster = applySnapshot({ s1: held }, [snapshotRow]);

    expect(roster.s1.status).toBe("arrived");
    expect(roster.s1.updated_at).toBe("2026-09-02T12:05:00.000Z");
    expect(roster.s1.class_groups).toEqual(["3rd"]);
  });

  it("updates an existing row when the snapshot carries the same timestamp", () => {
    const before: DisplayRoster = {
      s1: student({ id: "s1", first_name: "Jon" }),
    };
    const rows = [student({ id: "s1", first_name: "Jonathan" })];
    const roster = applySnapshot(before, rows);
    expect(roster.s1.first_name).toBe("Jonathan");
  });
});
