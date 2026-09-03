import { describe, expect, it } from "vitest";

import { createRateLimiter } from "../rate-limit.ts";
import { createFakeStore, makeStudent } from "./fake-store.ts";
import { createRosterResetHandler } from "./roster-reset.ts";

const STAFF_PIN = "4821";

function setup() {
  const store = createFakeStore([
    makeStudent({
      id: "cohen",
      first_name: "Maya",
      last_name: "Cohen",
      status: "arrived",
    }),
    makeStudent({
      id: "marsh",
      first_name: "Ava",
      last_name: "Marsh",
      status: "arrived",
    }),
    makeStudent({
      id: "ng",
      first_name: "Theo",
      last_name: "Ng",
      status: "waiting",
    }),
  ]);
  const handle = createRosterResetHandler({
    staffPin: STAFF_PIN,
    rateLimiter: createRateLimiter({ limit: 5, windowMs: 60_000 }),
    pinAttemptLimiter: createRateLimiter({ limit: 10, windowMs: 600_000 }),
    store,
  });
  return { store, handle };
}

const post = (body: unknown) =>
  new Request("https://example.test/roster-reset", {
    method: "POST",
    body: JSON.stringify(body),
  });

const reset = (overrides: Record<string, unknown> = {}) =>
  post({ pin: STAFF_PIN, deviceId: "office-1", ...overrides });

describe("createRosterResetHandler", () => {
  it("moves every arrived student back to waiting", async () => {
    const { handle, store } = setup();

    const response = await handle(reset());
    const body = (await response.json()) as { reset: number; logged: number };

    expect(response.status).toBe(200);
    expect(body.reset).toBe(2);
    expect(body.logged).toBe(2);
    expect(store.row("cohen")?.status).toBe("waiting");
    expect(store.row("marsh")?.status).toBe("waiting");
    expect(store.row("cohen")?.arrived_at).toBeNull();
  });

  it("never touches a student who was already waiting", async () => {
    const { handle, store } = setup();

    await handle(reset());

    // The fake store's updated_at for an untouched row is whatever makeStudent
    // set it to, not the mutation timestamp -- proof this row was never
    // written, not just that its status happens to already read "waiting".
    expect(store.row("ng")?.updated_at).toBe("2026-09-02T12:00:00.000Z");
  });

  it("logs one admin-sourced audit row per student actually moved", async () => {
    const { handle, store } = setup();

    await handle(reset());

    expect(store.events).toHaveLength(2);
    for (const event of store.events) {
      expect(event).toMatchObject({
        changedTo: "waiting",
        source: "admin",
        matchConfidence: null,
        rawTranscript: null,
      });
    }
    expect(store.events.map((e) => e.studentId).sort()).toEqual([
      "cohen",
      "marsh",
    ]);
  });

  it("is idempotent -- a second reset changes nothing and logs nothing", async () => {
    const { handle, store } = setup();

    await handle(reset());
    const response = await handle(reset());
    const body = (await response.json()) as { reset: number; logged: number };

    expect(body.reset).toBe(0);
    expect(body.logged).toBe(0);
    expect(store.events).toHaveLength(2);
  });

  it("requires the staff PIN, and changes nothing without it", async () => {
    const { handle, store } = setup();

    const response = await handle(reset({ pin: "0000" }));

    expect(response.status).toBe(401);
    expect(store.row("cohen")?.status).toBe("arrived");
    expect(store.events).toHaveLength(0);
  });

  it("still reports the reset when an audit row fails to log", async () => {
    const { store } = setup();
    const flaky = { ...store, logEvent: () => Promise.resolve(false) };
    const handle = createRosterResetHandler({
      staffPin: STAFF_PIN,
      rateLimiter: createRateLimiter({ limit: 5, windowMs: 60_000 }),
      pinAttemptLimiter: createRateLimiter({ limit: 10, windowMs: 600_000 }),
      store: flaky,
    });

    const response = await handle(reset());
    const body = (await response.json()) as { reset: number; logged: number };

    expect(response.status).toBe(200);
    expect(body.reset).toBe(2);
    expect(body.logged).toBe(0);
    // The status change stands even though the audit rows did not write --
    // undoing it would be worse than a gap in the log, same rule as /set-status.
    expect(store.row("cohen")?.status).toBe("waiting");
  });
});
