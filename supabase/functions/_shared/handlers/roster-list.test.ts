import { describe, expect, it } from "vitest";

import { createRateLimiter } from "../rate-limit.ts";
import { createFakeStore, makeStudent } from "./fake-store.ts";
import { createRosterListHandler } from "./roster-list.ts";

const STAFF_PIN = "4821";

function setup() {
  const store = createFakeStore([
    makeStudent({
      id: "cohen",
      first_name: "Maya",
      last_name: "Cohen",
      grade: "K",
      class_group: "K-Alvarez",
    }),
    makeStudent({
      id: "marsh",
      first_name: "Ava",
      last_name: "Marsh",
      grade: "1",
      class_group: "1-Diaz",
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

  it("narrows to one grade when asked", async () => {
    const { handle } = setup();

    const response = await handle(list({ grade: "1" }));
    const body = (await response.json()) as {
      students: Array<{ id: string }>;
    };

    expect(body.students.map((s) => s.id)).toEqual(["marsh"]);
  });

  it("requires the staff PIN", async () => {
    const { handle } = setup();

    const response = await handle(list({ pin: "0000" }));

    expect(response.status).toBe(401);
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
