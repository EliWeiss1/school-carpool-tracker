import { describe, expect, it } from "vitest";

import { createRateLimiter } from "../rate-limit.ts";
import { createFakeStore, makeStudent } from "./fake-store.ts";
import { createRosterDeleteHandler } from "./roster-delete.ts";

const STAFF_PIN = "4821";

function setup() {
  const store = createFakeStore([
    makeStudent({ id: "cohen", first_name: "Maya", last_name: "Cohen" }),
  ]);
  const handle = createRosterDeleteHandler({
    staffPin: STAFF_PIN,
    rateLimiter: createRateLimiter({ limit: 20, windowMs: 60_000 }),
    pinAttemptLimiter: createRateLimiter({ limit: 10, windowMs: 600_000 }),
    store,
  });
  return { store, handle };
}

const post = (body: unknown) =>
  new Request("https://example.test/roster-delete", {
    method: "POST",
    body: JSON.stringify(body),
  });

const del = (overrides: Record<string, unknown> = {}) =>
  post({ pin: STAFF_PIN, deviceId: "office-1", studentId: "cohen", ...overrides });

describe("createRosterDeleteHandler", () => {
  it("removes a student from the roster", async () => {
    const { handle, store } = setup();

    const response = await handle(del());
    const body = (await response.json()) as { deleted: boolean };

    expect(response.status).toBe(200);
    expect(body.deleted).toBe(true);
    expect(store.rows()).toHaveLength(0);
  });

  it("says so when the student is already gone", async () => {
    const { handle } = setup();

    const response = await handle(del({ studentId: "nobody" }));

    expect(response.status).toBe(404);
  });

  it("requires a student id", async () => {
    const { handle, store } = setup();

    const response = await handle(del({ studentId: "" }));

    expect(response.status).toBe(400);
    expect(store.rows()).toHaveLength(1);
  });

  it("requires the staff PIN", async () => {
    const { handle, store } = setup();

    const response = await handle(del({ pin: "0000" }));

    expect(response.status).toBe(401);
    expect(store.rows()).toHaveLength(1);
  });
});
