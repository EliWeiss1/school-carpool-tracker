import { describe, expect, it } from "vitest";

import { createRateLimiter } from "../rate-limit.ts";
import { createFakeStore, makeStudent } from "./fake-store.ts";
import { createStatusHandler } from "./status.ts";

const STAFF_PIN = "4821";

function setup() {
  const store = createFakeStore([
    makeStudent({ id: "cohen", first_name: "Maya", last_name: "Cohen" }),
    makeStudent({
      id: "marsh",
      first_name: "Ava",
      last_name: "Marsh",
      status: "arrived",
    }),
  ]);
  const handle = createStatusHandler({
    staffPin: STAFF_PIN,
    rateLimiter: createRateLimiter({ limit: 30, windowMs: 60_000 }),
    pinAttemptLimiter: createRateLimiter({ limit: 10, windowMs: 600_000 }),
    store,
  });
  return { store, handle };
}

/** Same setup, with one store method replaced by a failing or odd one. */
function setupWith(overrides: Partial<ReturnType<typeof createFakeStore>>) {
  const store = createFakeStore([
    makeStudent({ id: "cohen", first_name: "Maya", last_name: "Cohen" }),
  ]);
  const handle = createStatusHandler({
    staffPin: STAFF_PIN,
    rateLimiter: createRateLimiter({ limit: 30, windowMs: 60_000 }),
    pinAttemptLimiter: createRateLimiter({ limit: 10, windowMs: 600_000 }),
    store: { ...store, ...overrides },
  });
  return { store, handle };
}

const post = (body: unknown) =>
  new Request("https://example.test/set-status", {
    method: "POST",
    body: JSON.stringify(body),
  });

const confirm = (overrides: Record<string, unknown> = {}) =>
  post({
    pin: STAFF_PIN,
    deviceId: "phone-1",
    studentId: "cohen",
    status: "arrived",
    source: "voice",
    matchConfidence: 0.97,
    transcript: "Cohen",
    ...overrides,
  });

interface StatusBody {
  changed: boolean;
  student: { id: string; status: string; arrived_at: string | null };
}

describe("createStatusHandler", () => {
  it("marks a waiting student as arrived", async () => {
    const { handle, store } = setup();

    const response = await handle(confirm());
    const body = (await response.json()) as StatusBody;

    expect(response.status).toBe(200);
    expect(body.changed).toBe(true);
    expect(body.student.status).toBe("arrived");
    expect(store.row("cohen")?.status).toBe("arrived");
  });

  it("writes an audit row with what was heard and how sure the matcher was", async () => {
    const { handle, store } = setup();

    await handle(confirm());

    expect(store.events).toEqual([
      {
        studentId: "cohen",
        changedTo: "arrived",
        source: "voice",
        matchConfidence: 0.97,
        rawTranscript: "Cohen",
      },
    ]);
  });

  it("does nothing the second time two announcers confirm the same child", async () => {
    // Both phones tapped at once. The conditional update settles it, so the
    // display flashes once and the audit log gets one row, not two.
    const { handle, store } = setup();

    await handle(confirm());
    const response = await handle(confirm({ deviceId: "phone-2" }));
    const body = (await response.json()) as StatusBody;

    expect(response.status).toBe(200);
    expect(body.changed).toBe(false);
    expect(body.student.status).toBe("arrived");
    expect(store.events).toHaveLength(1);
  });

  it("undoes an arrival back to waiting", async () => {
    const { handle, store } = setup();

    const response = await handle(
      confirm({
        studentId: "marsh",
        status: "waiting",
        source: "manual",
        matchConfidence: null,
      }),
    );
    const body = (await response.json()) as StatusBody;

    expect(body.changed).toBe(true);
    expect(body.student.status).toBe("waiting");
    expect(body.student.arrived_at).toBeNull();
    expect(store.events[0]).toMatchObject({
      changedTo: "waiting",
      source: "manual",
    });
  });

  it("ignores an arrived_at sent by the caller", async () => {
    // arrived_at is derived by a database trigger. Accepting it from a client
    // would let a stale phone rewrite when a child was picked up.
    const { handle } = setup();

    const body = (await (
      await handle(confirm({ arrived_at: "1999-01-01T00:00:00.000Z" }))
    ).json()) as StatusBody;

    expect(body.student.arrived_at).not.toBe("1999-01-01T00:00:00.000Z");
  });

  it("says so when the student is not on the roster", async () => {
    const { handle } = setup();

    const response = await handle(confirm({ studentId: "nobody" }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: expect.stringMatching(/roster/i),
    });
  });

  it("rejects a status that is not waiting or arrived", async () => {
    const { handle, store } = setup();

    const response = await handle(confirm({ status: "gone-home" }));

    expect(response.status).toBe(400);
    expect(store.events).toEqual([]);
  });

  it("rejects a source that is not one of the three we log", async () => {
    const { handle } = setup();

    expect((await handle(confirm({ source: "robot" }))).status).toBe(400);
  });

  it("requires a student id", async () => {
    const { handle } = setup();

    expect((await handle(confirm({ studentId: "" }))).status).toBe(400);
  });

  it("logs no confidence for a student picked by hand", async () => {
    const { handle, store } = setup();

    await handle(
      confirm({
        source: "manual",
        matchConfidence: "very sure",
        transcript: null,
      }),
    );

    expect(store.events[0]).toMatchObject({
      matchConfidence: null,
      rawTranscript: null,
    });
  });

  it("requires the caller to say where the change came from", async () => {
    // Defaulting a missing source to "manual" silently logged voice
    // confirmations as hand-picked, with no transcript and no confidence --
    // quietly destroying the only record the thresholds can be retuned from.
    const { handle } = setup();
    const body = JSON.parse(await confirm().text()) as Record<string, unknown>;
    delete body.source;

    const response = await handle(post(body));

    expect(response.status).toBe(400);
  });

  it("tells the caller when the arrival could not be written to the audit log", async () => {
    const { store, handle } = setupWith({
      logEvent: () => Promise.resolve(false),
    });

    const body = (await (await handle(confirm())).json()) as StatusBody & {
      logged: boolean;
    };

    expect(body.changed).toBe(true);
    expect(body.logged).toBe(false);
    expect(store.row("cohen")?.status).toBe("arrived");
  });

  it("shows a readable message when the database is unreachable", async () => {
    // Without this the rejection escapes to Deno.serve, which answers 500 with
    // no CORS headers -- so the browser reports a CORS failure and the person
    // outside sees nothing useful at all.
    const { handle } = setupWith({
      setStatus: () =>
        Promise.reject(new Error("Could not update that student: down")),
    });

    const response = await handle(confirm());

    expect(response.status).toBe(503);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    await expect(response.json()).resolves.toEqual({
      error: expect.stringMatching(/could not/i),
    });
  });

  it("requires the staff PIN", async () => {
    const { handle, store } = setup();

    const response = await handle(confirm({ pin: "0000" }));

    expect(response.status).toBe(401);
    expect(store.row("cohen")?.status).toBe("waiting");
  });
});
