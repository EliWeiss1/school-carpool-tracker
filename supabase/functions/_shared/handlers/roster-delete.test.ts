import { describe, expect, it } from "vitest";

import { createRateLimiter } from "../rate-limit.ts";
import { createFakeStore, makeStudent } from "./fake-store.ts";
import { createRosterDeleteHandler } from "./roster-delete.ts";

const STAFF_PIN = "4821";

function setup() {
  const store = createFakeStore([
    makeStudent({ id: "cohen", first_name: "Maya", last_name: "Cohen" }),
    makeStudent({ id: "ng", first_name: "Theo", last_name: "Ng" }),
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
  post({
    pin: STAFF_PIN,
    deviceId: "office-1",
    studentId: "cohen",
    ...overrides,
  });

describe("createRosterDeleteHandler", () => {
  it("removes a student from the roster", async () => {
    const { handle, store } = setup();

    const response = await handle(del());
    const body = (await response.json()) as {
      deletedIds: string[];
      missingIds: string[];
    };

    expect(response.status).toBe(200);
    expect(body.deletedIds).toEqual(["cohen"]);
    expect(body.missingIds).toEqual([]);
    expect(store.rows()).toHaveLength(1);
  });

  it("removes several students at once via studentIds", async () => {
    const { handle, store } = setup();

    const response = await handle(
      del({ studentId: undefined, studentIds: ["cohen", "ng"] }),
    );
    const body = (await response.json()) as {
      deletedIds: string[];
      missingIds: string[];
    };

    expect(response.status).toBe(200);
    expect(body.deletedIds.sort()).toEqual(["cohen", "ng"]);
    expect(body.missingIds).toEqual([]);
    expect(store.rows()).toHaveLength(0);
  });

  it("reports ids that were already gone rather than failing the whole call", async () => {
    const { handle, store } = setup();

    const response = await handle(
      del({ studentId: undefined, studentIds: ["cohen", "nobody"] }),
    );
    const body = (await response.json()) as {
      deletedIds: string[];
      missingIds: string[];
    };

    expect(response.status).toBe(200);
    expect(body.deletedIds).toEqual(["cohen"]);
    expect(body.missingIds).toEqual(["nobody"]);
    expect(store.rows()).toHaveLength(1);
  });

  it("says so when every requested student is already gone", async () => {
    const { handle } = setup();

    const response = await handle(del({ studentId: "nobody" }));

    expect(response.status).toBe(404);
  });

  it("requires a student id", async () => {
    const { handle, store } = setup();

    const response = await handle(del({ studentId: "" }));

    expect(response.status).toBe(400);
    expect(store.rows()).toHaveLength(2);
  });

  it("requires the staff PIN", async () => {
    const { handle, store } = setup();

    const response = await handle(del({ pin: "0000" }));

    expect(response.status).toBe(401);
    expect(store.rows()).toHaveLength(2);
  });
});
