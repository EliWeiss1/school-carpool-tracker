import { describe, expect, it } from "vitest";

import { createRateLimiter } from "../rate-limit.ts";
import { createCarpoolWriteHandler } from "./carpool-write.ts";
import { createFakeStore, makeCarpool, makeStudent } from "./fake-store.ts";

const STAFF_PIN = "4821";

function setup() {
  const store = createFakeStore(
    [
      makeStudent({ id: "cohen", first_name: "Maya", last_name: "Cohen" }),
      makeStudent({ id: "kohen", first_name: "Elias", last_name: "Kohen" }),
      makeStudent({ id: "weiss", first_name: "Sara", last_name: "Weiss" }),
    ],
    [makeCarpool({ id: "weiss-carpool", name: "Weiss Carpool" })],
  );
  const handle = createCarpoolWriteHandler({
    staffPin: STAFF_PIN,
    rateLimiter: createRateLimiter({ limit: 30, windowMs: 60_000 }),
    pinAttemptLimiter: createRateLimiter({ limit: 3, windowMs: 600_000 }),
    store,
  });
  return { store, handle };
}

const post = (body: unknown) =>
  new Request("https://example.test/carpool-write", {
    method: "POST",
    body: JSON.stringify(body),
  });

const base = (overrides: Record<string, unknown> = {}) =>
  post({ pin: STAFF_PIN, deviceId: "office-1", ...overrides });

describe("createCarpoolWriteHandler — create", () => {
  it("creates a carpool with no members", async () => {
    const { handle, store } = setup();

    const response = await handle(
      base({ action: "create", name: "Nguyen Carpool" }),
    );
    const body = (await response.json()) as {
      created: boolean;
      carpool: { name: string; aliases: string[] };
    };

    expect(response.status).toBe(200);
    expect(body.created).toBe(true);
    expect(body.carpool.name).toBe("Nguyen Carpool");
    expect((await store.listCarpools()).map((c) => c.name)).toContain(
      "Nguyen Carpool",
    );
  });

  it("links members given at creation time", async () => {
    const { handle, store } = setup();

    const response = await handle(
      base({
        action: "create",
        name: "Cohen Carpool",
        memberIds: ["cohen", "kohen"],
      }),
    );
    const body = (await response.json()) as {
      carpool: { id: string };
    };

    expect(store.row("cohen")?.carpool_id).toBe(body.carpool.id);
    expect(store.row("kohen")?.carpool_id).toBe(body.carpool.id);
    expect(store.row("weiss")?.carpool_id).toBeNull();
  });

  it("requires a name", async () => {
    const { handle } = setup();

    const response = await handle(base({ action: "create" }));

    expect(response.status).toBe(400);
  });

  it("rejects a duplicate name, case-insensitively", async () => {
    const { handle } = setup();

    const response = await handle(
      base({ action: "create", name: "weiss carpool" }),
    );

    expect(response.status).toBe(409);
  });

  it("requires the staff PIN", async () => {
    const { handle } = setup();

    const response = await handle(
      base({ action: "create", name: "New Carpool", pin: "0000" }),
    );

    expect(response.status).toBe(401);
  });
});

describe("createCarpoolWriteHandler — update", () => {
  it("renames a carpool", async () => {
    const { handle } = setup();

    const response = await handle(
      base({
        action: "update",
        carpoolId: "weiss-carpool",
        name: "The Weiss Van",
      }),
    );
    const body = (await response.json()) as { carpool: { name: string } };

    expect(response.status).toBe(200);
    expect(body.carpool.name).toBe("The Weiss Van");
  });

  it("says so when the carpool no longer exists", async () => {
    const { handle } = setup();

    const response = await handle(
      base({ action: "update", carpoolId: "nobody", name: "X" }),
    );

    expect(response.status).toBe(404);
  });

  it("rejects renaming to a name another carpool already has", async () => {
    const { handle, store } = setup();
    await store.createCarpool({ name: "Other Carpool", aliases: [] });

    const response = await handle(
      base({
        action: "update",
        carpoolId: "weiss-carpool",
        name: "Other Carpool",
      }),
    );

    expect(response.status).toBe(409);
  });

  it("replaces membership: adds new members and unlinks omitted ones", async () => {
    const { handle, store } = setup();
    await store.setCarpoolMembers("weiss-carpool", ["cohen", "weiss"]);

    const response = await handle(
      base({
        action: "update",
        carpoolId: "weiss-carpool",
        memberIds: ["cohen", "kohen"],
      }),
    );

    expect(response.status).toBe(200);
    expect(store.row("cohen")?.carpool_id).toBe("weiss-carpool");
    expect(store.row("kohen")?.carpool_id).toBe("weiss-carpool");
    // Weiss was a member before and is omitted from the new list -- unlinked,
    // not left dangling on a membership the admin just replaced.
    expect(store.row("weiss")?.carpool_id).toBeNull();
  });

  it("leaves membership untouched when memberIds is not sent", async () => {
    const { handle, store } = setup();
    await store.setCarpoolMembers("weiss-carpool", ["weiss"]);

    await handle(
      base({ action: "update", carpoolId: "weiss-carpool", name: "Renamed" }),
    );

    expect(store.row("weiss")?.carpool_id).toBe("weiss-carpool");
  });

  it("can clear a carpool down to zero members", async () => {
    const { handle, store } = setup();
    await store.setCarpoolMembers("weiss-carpool", ["cohen", "weiss"]);

    await handle(
      base({ action: "update", carpoolId: "weiss-carpool", memberIds: [] }),
    );

    expect(store.row("cohen")?.carpool_id).toBeNull();
    expect(store.row("weiss")?.carpool_id).toBeNull();
  });
});

describe("createCarpoolWriteHandler — delete", () => {
  it("removes the carpool and unlinks its members, without deleting them", async () => {
    const { handle, store } = setup();
    await store.setCarpoolMembers("weiss-carpool", ["weiss"]);

    const response = await handle(
      base({ action: "delete", carpoolId: "weiss-carpool" }),
    );
    const body = (await response.json()) as { deleted: boolean };

    expect(response.status).toBe(200);
    expect(body.deleted).toBe(true);
    expect(await store.listCarpools()).toHaveLength(0);
    expect(store.row("weiss")).toBeDefined();
    expect(store.row("weiss")?.carpool_id).toBeNull();
  });

  it("says so when the carpool is already gone", async () => {
    const { handle } = setup();

    const response = await handle(
      base({ action: "delete", carpoolId: "nobody" }),
    );

    expect(response.status).toBe(404);
  });
});

describe("createCarpoolWriteHandler — validation", () => {
  it("rejects a missing or unknown action", async () => {
    const { handle } = setup();

    expect((await handle(base({}))).status).toBe(400);
    expect((await handle(base({ action: "explode" }))).status).toBe(400);
  });
});
