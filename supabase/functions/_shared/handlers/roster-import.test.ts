import { describe, expect, it } from "vitest";

import { createRateLimiter } from "../rate-limit.ts";
import { createFakeStore, makeStudent } from "./fake-store.ts";
import { createRosterImportHandler } from "./roster-import.ts";

const STAFF_PIN = "4821";

function setup() {
  const store = createFakeStore([
    makeStudent({ id: "cohen", first_name: "Maya", last_name: "Cohen" }),
  ]);
  const handle = createRosterImportHandler({
    staffPin: STAFF_PIN,
    rateLimiter: createRateLimiter({ limit: 5, windowMs: 60_000 }),
    pinAttemptLimiter: createRateLimiter({ limit: 10, windowMs: 600_000 }),
    store,
  });
  return { store, handle };
}

const post = (body: unknown) =>
  new Request("https://example.test/roster-import", {
    method: "POST",
    body: JSON.stringify(body),
  });

const imp = (students: unknown, overrides: Record<string, unknown> = {}) =>
  post({ pin: STAFF_PIN, deviceId: "office-1", students, ...overrides });

describe("createRosterImportHandler", () => {
  it("bulk-creates every student the client already validated", async () => {
    const { handle, store } = setup();

    const response = await handle(
      imp([
        { first_name: "Theo", last_name: "Ng", aliases: ["Eng"] },
        { first_name: "Nora", last_name: "Chen" },
      ]),
    );
    const body = (await response.json()) as { created: number };

    expect(response.status).toBe(200);
    expect(body.created).toBe(2);
    expect(store.rows()).toHaveLength(3);
  });

  it("rejects an empty list", async () => {
    const { handle, store } = setup();

    const response = await handle(imp([]));

    expect(response.status).toBe(400);
    expect(store.rows()).toHaveLength(1);
  });

  it("rejects a row with no first or last name rather than importing the rest", async () => {
    // The client should never send an invalid row -- csv-import.ts filters
    // those into the report's error list -- but this endpoint does not trust
    // that: a malformed body fails the whole import instead of silently
    // dropping one child from a school roster.
    const { handle, store } = setup();

    const response = await handle(
      imp([
        { first_name: "Theo", last_name: "Ng" },
        { first_name: "", last_name: "Broken" },
      ]),
    );

    expect(response.status).toBe(400);
    expect(store.rows()).toHaveLength(1);
  });

  it("rejects a students field that is not an array", async () => {
    const { handle } = setup();

    const response = await handle(imp("not-an-array"));

    expect(response.status).toBe(400);
  });

  it("caps how many students one import can add", async () => {
    const { handle, store } = setup();
    const many = Array.from({ length: 1001 }, (_, i) => ({
      first_name: "Kid",
      last_name: `Number${i}`,
    }));

    const response = await handle(imp(many));

    expect(response.status).toBe(400);
    expect(store.rows()).toHaveLength(1);
  });

  it("requires the staff PIN", async () => {
    const { handle, store } = setup();

    const response = await handle(
      imp([{ first_name: "Theo", last_name: "Ng" }], { pin: "0000" }),
    );

    expect(response.status).toBe(401);
    expect(store.rows()).toHaveLength(1);
  });
});
