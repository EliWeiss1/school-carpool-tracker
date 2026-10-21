import { describe, expect, it } from "vitest";

import { createRateLimiter } from "../rate-limit.ts";
import {
  createFakeStore,
  makeCarpool,
  makeClassGroup,
  makeStudent,
} from "./fake-store.ts";
import { createRosterListHandler } from "./roster-list.ts";

const STAFF_PIN = "4821";

function setup() {
  const store = createFakeStore([
    makeStudent({
      id: "cohen",
      first_name: "Maya",
      last_name: "Cohen",
      class_groups: ["K1"],
    }),
    makeStudent({
      id: "marsh",
      first_name: "Ava",
      last_name: "Marsh",
      class_groups: ["1st"],
      status: "arrived",
    }),
  ]);
  const handle = createRosterListHandler({
    staffPin: STAFF_PIN,
    rateLimiter: createRateLimiter({ limit: 60, windowMs: 60_000 }),
    pinAttemptLimiter: createRateLimiter({ limit: 10, windowMs: 600_000 }),
    store,
  });
  return { store, handle };
}

const post = (body: unknown) =>
  new Request("https://example.test/roster-list", {
    method: "POST",
    body: JSON.stringify(body),
  });

const list = (overrides: Record<string, unknown> = {}) =>
  post({ pin: STAFF_PIN, deviceId: "office-1", ...overrides });

describe("createRosterListHandler", () => {
  it("returns every student regardless of status", async () => {
    const { handle } = setup();

    const response = await handle(list());
    const body = (await response.json()) as {
      students: Array<{ id: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.students.map((s) => s.id).sort()).toEqual(["cohen", "marsh"]);
  });

  it("narrows to one class when asked", async () => {
    const { handle } = setup();

    const response = await handle(list({ classGroup: "1st" }));
    const body = (await response.json()) as {
      students: Array<{ id: string }>;
    };

    expect(body.students.map((s) => s.id)).toEqual(["marsh"]);
  });

  it("returns class member counts", async () => {
    const store = createFakeStore(
      [
        makeStudent({ id: "a", class_groups: ["K1"] }),
        makeStudent({ id: "b", class_groups: ["K1", "1st"] }),
        makeStudent({ id: "c" }),
      ],
      [],
      [
        makeClassGroup({ id: "k1", name: "K1", sort_order: 0 }),
        makeClassGroup({ id: "first", name: "1st", sort_order: 1 }),
        makeClassGroup({ id: "empty", name: "2nd", sort_order: 2 }),
      ],
    );
    const handle = createRosterListHandler({
      staffPin: STAFF_PIN,
      rateLimiter: createRateLimiter({ limit: 60, windowMs: 60_000 }),
      pinAttemptLimiter: createRateLimiter({ limit: 10, windowMs: 600_000 }),
      store,
    });

    const response = await handle(list());
    const body = (await response.json()) as {
      classMemberCounts: Record<string, number>;
    };

    // Counted over the whole school, not just the filtered view; a class with
    // nobody in it may be absent.
    expect(body.classMemberCounts).toEqual({ k1: 2, first: 1 });
  });

  it("counts every member even when the list is filtered to one class", async () => {
    const { handle } = setup();

    const response = await handle(list({ classGroups: ["1st"] }));
    const body = (await response.json()) as {
      classMemberCounts: Record<string, number>;
      students: unknown[];
    };

    expect(body.students).toHaveLength(1);
    expect(Object.values(body.classMemberCounts).sort()).toEqual([1, 1]);
  });

  it("requires the staff PIN", async () => {
    const { handle } = setup();

    const response = await handle(list({ pin: "0000" }));

    expect(response.status).toBe(401);
  });

  it("returns every carpool alongside the roster", async () => {
    const store = createFakeStore(
      [makeStudent({ id: "cohen", first_name: "Maya", last_name: "Cohen" })],
      [makeCarpool({ id: "weiss", name: "Weiss Carpool" })],
    );
    const handle = createRosterListHandler({
      staffPin: STAFF_PIN,
      rateLimiter: createRateLimiter({ limit: 60, windowMs: 60_000 }),
      pinAttemptLimiter: createRateLimiter({ limit: 10, windowMs: 600_000 }),
      store,
    });

    const response = await handle(list());
    const body = (await response.json()) as {
      carpools: Array<{ id: string; name: string }>;
    };

    expect(body.carpools).toEqual([
      expect.objectContaining({ id: "weiss", name: "Weiss Carpool" }),
    ]);
  });

  it("shows a readable message when the database is unreachable", async () => {
    const { store } = setup();
    const broken = {
      ...store,
      list: () => Promise.reject(new Error("Could not read the roster: down")),
    };
    const handleBroken = createRosterListHandler({
      staffPin: STAFF_PIN,
      rateLimiter: createRateLimiter({ limit: 60, windowMs: 60_000 }),
      pinAttemptLimiter: createRateLimiter({ limit: 10, windowMs: 600_000 }),
      store: broken,
    });

    const response = await handleBroken(list());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: expect.stringMatching(/could not/i),
    });
  });
});
