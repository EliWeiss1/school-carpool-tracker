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
  it("removes a class without touching a student already using that value", async () => {
    const { handle, store } = setup();
    // Give the seeded student a class_group matching one of the classes
    // about to be deleted -- deleting the class must not touch this.
    await store.updateStudent("cohen", { class_group: "K1" } as never);

    const response = await handle(base({ action: "delete", classId: "k1" }));
    const body = (await response.json()) as { deleted: boolean };

    expect(response.status).toBe(200);
    expect(body.deleted).toBe(true);
    expect(store.classGroupRows().map((c) => c.id)).toEqual(["k2"]);
    expect(store.row("cohen")?.class_group).toBe("K1");
  });

  it("says so when the class no longer exists", async () => {
    const { handle } = setup();

    const response = await handle(
      base({ action: "delete", classId: "nonexistent" }),
    );

    expect(response.status).toBe(404);
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
