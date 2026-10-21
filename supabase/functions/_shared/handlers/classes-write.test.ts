import { describe, expect, it } from "vitest";

import { createRateLimiter } from "../rate-limit.ts";
import { createClassesWriteHandler } from "./classes-write.ts";
import { createFakeStore, makeClassGroup, makeStudent } from "./fake-store.ts";

const STAFF_PIN = "4821";

function setup() {
  const store = createFakeStore(
    [makeStudent({ id: "cohen" })],
    [],
    [
      makeClassGroup({ id: "k1", name: "K1", sort_order: 0 }),
      makeClassGroup({ id: "k2", name: "K2", sort_order: 1 }),
    ],
  );
  const handle = createClassesWriteHandler({
    staffPin: STAFF_PIN,
    rateLimiter: createRateLimiter({ limit: 30, windowMs: 60_000 }),
    pinAttemptLimiter: createRateLimiter({ limit: 2, windowMs: 600_000 }),
    store,
  });
  return { store, handle };
}

const post = (body: unknown) =>
  new Request("https://example.test/classes-write", {
    method: "POST",
    body: JSON.stringify(body),
  });

const base = (overrides: Record<string, unknown> = {}) =>
  post({ pin: STAFF_PIN, deviceId: "office-1", ...overrides });

describe("createClassesWriteHandler — create", () => {
  it("adds a class, appended after the current highest sort_order", async () => {
    const { handle, store } = setup();

    const response = await handle(
      base({ action: "create", name: "EC Hummingbirds" }),
    );
    const body = (await response.json()) as {
      created: boolean;
      classGroup: { name: string; sort_order: number };
    };

    expect(response.status).toBe(200);
    expect(body.created).toBe(true);
    expect(body.classGroup.name).toBe("EC Hummingbirds");
    expect(body.classGroup.sort_order).toBe(2);
    expect(store.classGroupRows()).toHaveLength(3);
  });

  it("rejects a duplicate name, case-insensitively", async () => {
    const { handle, store } = setup();

    const response = await handle(base({ action: "create", name: "k1" }));

    expect(response.status).toBe(409);
    expect(store.classGroupRows()).toHaveLength(2);
  });

  it("requires a name", async () => {
    const { handle } = setup();

    const response = await handle(base({ action: "create", name: "" }));

    expect(response.status).toBe(400);
  });

  it("requires the staff PIN", async () => {
    const { handle } = setup();

    const response = await handle(
      base({ action: "create", name: "1st", pin: "0000" }),
    );

    expect(response.status).toBe(401);
  });
});

describe("createClassesWriteHandler — delete", () => {
  /** Roster with K1 holding `solo` (only K1) and `both` (K1 and K2); K2 also
   *  holds `k2only`. `loner` is in no class at all. */
  function withMembers() {
    const store = createFakeStore(
      [
        makeStudent({
          id: "solo",
          first_name: "Sol",
          last_name: "Aronson",
          class_groups: ["K1"],
        }),
        makeStudent({
          id: "both",
          first_name: "Bo",
          last_name: "Berman",
          class_groups: ["K1", "K2"],
        }),
        makeStudent({ id: "k2only", class_groups: ["K2"] }),
        makeStudent({ id: "loner" }),
      ],
      [],
      [
        makeClassGroup({ id: "k1", name: "K1", sort_order: 0 }),
        makeClassGroup({ id: "k2", name: "K2", sort_order: 1 }),
      ],
    );
    const handle = createClassesWriteHandler({
      staffPin: STAFF_PIN,
      rateLimiter: createRateLimiter({ limit: 30, windowMs: 60_000 }),
      pinAttemptLimiter: createRateLimiter({ limit: 2, windowMs: 600_000 }),
      store,
    });
    return { store, handle };
  }

  it("delete with no sole members deletes", async () => {
    const { handle, store } = withMembers();
    // Only `both` is left in K1, and K2 still has them.
    await store.changeClassMembers("k1", [], ["solo"]);

    const response = await handle(base({ action: "delete", classId: "k1" }));
    const body = (await response.json()) as {
      deleted: boolean;
      movedCount: number;
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({ deleted: true, movedCount: 0 });
    expect(store.classGroupRows().map((c) => c.id)).toEqual(["k2"]);
    expect(store.row("both")?.class_groups).toEqual(["K2"]);
    expect(store.rows()).toHaveLength(4);
  });

  it("deletes an empty class", async () => {
    const { handle, store } = setup();

    const response = await handle(base({ action: "delete", classId: "k1" }));

    expect(response.status).toBe(200);
    expect(store.classGroupRows().map((c) => c.id)).toEqual(["k2"]);
  });

  it("delete with sole members returns 409 with count and sample", async () => {
    const { handle, store } = withMembers();

    const response = await handle(base({ action: "delete", classId: "k1" }));
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: "1 student is only in this class.",
      memberCount: 2,
      soleMemberCount: 1,
      soleMembers: [{ id: "solo", first_name: "Sol", last_name: "Aronson" }],
    });
    // Nothing was deleted or unlinked.
    expect(store.classGroupRows()).toHaveLength(2);
    expect(store.row("solo")?.class_groups).toEqual(["K1"]);
  });

  it("pluralises the 409 sentence", async () => {
    const { handle, store } = withMembers();
    await store.changeClassMembers("k1", ["loner"], []);

    const response = await handle(base({ action: "delete", classId: "k1" }));
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(409);
    expect(body.error).toBe("2 students are only in this class.");
  });

  it("delete with moveToClassId moves every member (including one in another class) then deletes", async () => {
    const { handle, store } = withMembers();

    const response = await handle(
      base({ action: "delete", classId: "k1", moveToClassId: "k2" }),
    );
    const body = (await response.json()) as {
      deleted: boolean;
      movedCount: number;
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({ deleted: true, movedCount: 2 });
    expect(store.classGroupRows().map((c) => c.id)).toEqual(["k2"]);
    expect(store.row("solo")?.class_groups).toEqual(["K2"]);
    expect(store.row("both")?.class_groups).toEqual(["K2"]);
    expect(store.row("k2only")?.class_groups).toEqual(["K2"]);
  });

  it("delete with force leaves sole members classless", async () => {
    const { handle, store } = withMembers();

    const response = await handle(
      base({ action: "delete", classId: "k1", force: true }),
    );
    const body = (await response.json()) as { deleted: boolean };

    expect(response.status).toBe(200);
    expect(body.deleted).toBe(true);
    expect(store.classGroupRows().map((c) => c.id)).toEqual(["k2"]);
    expect(store.row("solo")?.class_groups).toEqual([]);
    expect(store.row("both")?.class_groups).toEqual(["K2"]);
    // Students themselves are never deleted.
    expect(store.rows()).toHaveLength(4);
  });

  it("moveToClassId equal to the class is 400", async () => {
    const { handle, store } = withMembers();

    const response = await handle(
      base({ action: "delete", classId: "k1", moveToClassId: "k1" }),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Choose a different class to move them to.");
    expect(store.classGroupRows()).toHaveLength(2);
  });

  it("a moveToClassId that is not a class is 400 too", async () => {
    const { handle } = withMembers();

    const response = await handle(
      base({ action: "delete", classId: "k1", moveToClassId: "ghost" }),
    );

    expect(response.status).toBe(400);
  });

  it("deleting a missing class is 404", async () => {
    const { handle } = setup();

    const response = await handle(
      base({ action: "delete", classId: "nonexistent" }),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe("That class no longer exists.");
  });

  it("asks which class when none is named", async () => {
    const { handle } = setup();

    const response = await handle(base({ action: "delete" }));

    expect(response.status).toBe(400);
  });
});

describe("createClassesWriteHandler — members", () => {
  function withRoster() {
    const store = createFakeStore(
      [
        makeStudent({ id: "a", class_groups: ["K1"] }),
        makeStudent({ id: "b" }),
        makeStudent({ id: "c" }),
      ],
      [],
      [
        makeClassGroup({ id: "k1", name: "K1", sort_order: 0 }),
        makeClassGroup({ id: "k2", name: "K2", sort_order: 1 }),
      ],
    );
    const handle = createClassesWriteHandler({
      staffPin: STAFF_PIN,
      rateLimiter: createRateLimiter({ limit: 30, windowMs: 60_000 }),
      pinAttemptLimiter: createRateLimiter({ limit: 2, windowMs: 600_000 }),
      store,
    });
    return { store, handle };
  }

  const members = (overrides: Record<string, unknown>) =>
    base({ action: "members", classId: "k1", ...overrides });

  it("members adds, removes, and is idempotent on re-add", async () => {
    const { handle, store } = withRoster();

    const first = await handle(
      members({ addStudentIds: ["b", "c"], removeStudentIds: ["a"] }),
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ memberCount: 2, ignoredIds: [] });
    expect(store.row("a")?.class_groups).toEqual([]);
    expect(store.row("b")?.class_groups).toEqual(["K1"]);

    const again = await handle(members({ addStudentIds: ["b", "c"] }));
    expect(await again.json()).toEqual({ memberCount: 2, ignoredIds: [] });
  });

  it("reports ids that are not on the roster", async () => {
    const { handle } = withRoster();

    const response = await handle(
      members({ addStudentIds: ["b", "ghost"], removeStudentIds: ["gone"] }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      memberCount: 2,
      ignoredIds: ["ghost", "gone"].sort(),
    });
  });

  it("accepts a request with only removals", async () => {
    const { handle, store } = withRoster();

    const response = await handle(members({ removeStudentIds: ["a"] }));

    expect(response.status).toBe(200);
    expect(store.row("a")?.class_groups).toEqual([]);
  });

  it("members with a missing class is 404", async () => {
    const { handle } = withRoster();

    const response = await handle(
      members({ classId: "nonexistent", addStudentIds: ["b"] }),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe("That class no longer exists.");
  });

  it("members rejects an empty request", async () => {
    const { handle, store } = withRoster();

    for (const body of [
      {},
      { addStudentIds: [], removeStudentIds: [] },
      { addStudentIds: ["", "  ", 7], removeStudentIds: "b" },
    ]) {
      const response = await handle(members(body));
      expect(response.status).toBe(400);
    }
    expect(store.row("a")?.class_groups).toEqual(["K1"]);
  });

  it("members needs a class", async () => {
    const { handle } = withRoster();

    const response = await handle(
      base({ action: "members", addStudentIds: ["b"] }),
    );

    expect(response.status).toBe(400);
  });

  it("members rejects more than 500 ids in either list", async () => {
    const { handle } = withRoster();
    const flood = Array.from({ length: 501 }, (_, i) => `s-${i}`);

    const adds = await handle(members({ addStudentIds: flood }));
    const removes = await handle(members({ removeStudentIds: flood }));

    expect(adds.status).toBe(400);
    expect(removes.status).toBe(400);
  });

  it("members accepts exactly 500 ids", async () => {
    const { handle } = withRoster();
    const exact = Array.from({ length: 500 }, (_, i) => `s-${i}`);

    const response = await handle(members({ addStudentIds: exact }));

    expect(response.status).toBe(200);
  });

  it("members requires the staff PIN", async () => {
    const { handle, store } = withRoster();

    const response = await handle(
      members({ addStudentIds: ["b"], pin: "0000" }),
    );

    expect(response.status).toBe(401);
    expect(store.row("b")?.class_groups).toEqual([]);
  });
});

describe("createClassesWriteHandler — reorder", () => {
  it("rewrites sort_order to match the given id order", async () => {
    const { handle, store } = setup();

    const response = await handle(
      base({ action: "reorder", orderedIds: ["k2", "k1"] }),
    );
    const body = (await response.json()) as {
      classGroups: Array<{ id: string; sort_order: number }>;
    };

    expect(response.status).toBe(200);
    expect(body.classGroups.map((c) => c.id)).toEqual(["k2", "k1"]);
    expect(store.classGroupRows().find((c) => c.id === "k2")?.sort_order).toBe(
      0,
    );
    expect(store.classGroupRows().find((c) => c.id === "k1")?.sort_order).toBe(
      1,
    );
  });

  it("requires an order to be sent", async () => {
    const { handle } = setup();

    const response = await handle(base({ action: "reorder" }));

    expect(response.status).toBe(400);
  });
});

describe("createClassesWriteHandler — action validation", () => {
  it("rejects an unrecognized action", async () => {
    const { handle } = setup();

    const response = await handle(base({ action: "rename" }));

    expect(response.status).toBe(400);
  });
});
