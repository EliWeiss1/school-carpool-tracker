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

describe("roster-import — a repeated import must not duplicate the roster", () => {
  // A duplicated roster is not a cosmetic problem. Two identical rows score
  // identically in the resolver, so the margin between them is 0, which is
  // below MATCH_POLICY.clearMargin -- and the "clear" tier stops existing for
  // every child in the school. The realistic trigger is mundane: the request
  // commits, the response is lost on school wifi, the admin presses Import
  // again.
  it("rejects an import containing a student already on the roster", async () => {
    const { store, handle } = setup();

    const response = await handle(
      imp([{ first_name: "Maya", last_name: "Cohen" }]),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/already on the roster/i),
    });
    expect(store.rows()).toHaveLength(1);
  });

  it("names the child that collided, so the admin can find the row", async () => {
    const { handle } = setup();

    const response = await handle(
      imp([
        { first_name: "Theo", last_name: "Ng" },
        { first_name: "Maya", last_name: "Cohen" },
      ]),
    );

    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("Maya Cohen"),
    });
  });

  it("writes nothing at all when one row collides", async () => {
    const { store, handle } = setup();

    await handle(
      imp([
        { first_name: "Theo", last_name: "Ng" },
        { first_name: "Maya", last_name: "Cohen" },
      ]),
    );

    // All-or-nothing: half a roster is worse than none, because nobody can
    // tell which half landed.
    expect(store.rows()).toHaveLength(1);
  });

  it("matches names case-insensitively, the way the resolver does", async () => {
    const { handle } = setup();

    const response = await handle(
      imp([{ first_name: "maya", last_name: "COHEN" }]),
    );

    expect(response.status).toBe(409);
  });

  it("still accepts an import of genuinely new students", async () => {
    const { store, handle } = setup();

    const response = await handle(
      imp([
        { first_name: "Theo", last_name: "Ng" },
        { first_name: "Ava", last_name: "Marsh" },
      ]),
    );

    expect(response.status).toBe(200);
    expect(store.rows()).toHaveLength(3);
  });

  it("rejects a name too long to be a name", async () => {
    const { handle } = setup();

    const response = await handle(
      imp([{ first_name: "Theo", last_name: "N".repeat(400) }]),
    );

    expect(response.status).toBe(400);
  });
});
