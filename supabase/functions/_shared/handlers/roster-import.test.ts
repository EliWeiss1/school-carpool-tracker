import { describe, expect, it } from "vitest";

import { createRateLimiter } from "../rate-limit.ts";
import { createFakeStore, makeClassGroup, makeStudent } from "./fake-store.ts";
import { createRosterImportHandler } from "./roster-import.ts";

const STAFF_PIN = "4821";

function setup() {
  const store = createFakeStore(
    [makeStudent({ id: "cohen", first_name: "Maya", last_name: "Cohen" })],
    [],
    [
      makeClassGroup({ id: "k1", name: "K1", sort_order: 0 }),
      makeClassGroup({ id: "first", name: "1st", sort_order: 1 }),
      makeClassGroup({ id: "second", name: "2nd", sort_order: 2 }),
    ],
  );
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

  it("carries parent names through the import", async () => {
    const { handle, store } = setup();

    const response = await handle(
      imp([
        {
          first_name: "Eli",
          last_name: "Weiss",
          parent1_name: "Dana Weiss",
          parent2_name: "Mark Weiss",
        },
      ]),
    );
    const body = (await response.json()) as {
      students: Array<{ id: string; parent1_name: string | null }>;
    };

    expect(response.status).toBe(200);
    expect(body.students[0].parent1_name).toBe("Dana Weiss");
    expect(store.row(body.students[0].id)?.parent2_name).toBe("Mark Weiss");
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

describe("createRosterImportHandler — classes", () => {
  it("imports rows with multiple classes", async () => {
    const { handle, store } = setup();

    const response = await handle(
      imp([
        { first_name: "Theo", last_name: "Ng", class_groups: ["2nd", "K1"] },
        { first_name: "Nora", last_name: "Chen", class_groups: ["1st"] },
        { first_name: "Sam", last_name: "Roe" },
      ]),
    );
    const body = (await response.json()) as {
      students: Array<{ last_name: string; class_groups: string[] }>;
    };

    expect(response.status).toBe(200);
    expect(body.students.map((s) => s.class_groups)).toEqual([
      ["K1", "2nd"],
      ["1st"],
      [],
    ]);
    expect(
      store.rows().find((s) => s.last_name === "Ng")?.class_groups,
    ).toEqual(["K1", "2nd"]);
  });

  it("unknown class name is 422 naming the first unknown, and imports nothing", async () => {
    const { handle, store } = setup();

    const response = await handle(
      imp([
        { first_name: "Theo", last_name: "Ng", class_groups: ["K1"] },
        {
          first_name: "Nora",
          last_name: "Chen",
          class_groups: ["Art", "Chess"],
        },
        { first_name: "Sam", last_name: "Roe", class_groups: ["Chess"] },
      ]),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(422);
    expect(body.error).toBe(
      'There\'s no class called "Art". Add it under Classes first.',
    );
    expect(store.rows()).toHaveLength(1);
    expect(await store.listCarpools()).toHaveLength(0);
  });

  it("duplicate and differently-cased names collapse", async () => {
    const { handle, store } = setup();

    const response = await handle(
      imp([
        {
          first_name: "Theo",
          last_name: "Ng",
          class_groups: ["k1", "K1", " 1ST ", "1st"],
        },
      ]),
    );

    expect(response.status).toBe(200);
    expect(
      store.rows().find((s) => s.last_name === "Ng")?.class_groups,
    ).toEqual(["K1", "1st"]);
  });

  it("singular class_group is rejected 400 and imports nothing", async () => {
    const { handle, store } = setup();

    const response = await handle(
      imp([
        { first_name: "Nora", last_name: "Chen", class_groups: ["K1"] },
        { first_name: "Theo", last_name: "Ng", class_group: "K1" },
      ]),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe(
      "This page is out of date. Reload it and try again.",
    );
    expect(store.rows()).toHaveLength(1);
  });
});

describe("createRosterImportHandler — carpools", () => {
  it("creates a new carpool named in the file and links its members", async () => {
    const { handle, store } = setup();

    await handle(
      imp([
        { first_name: "Theo", last_name: "Ng", carpool: "Weiss Carpool" },
        { first_name: "Nora", last_name: "Chen", carpool: "Weiss Carpool" },
      ]),
    );

    const carpools = await store.listCarpools();
    expect(carpools).toHaveLength(1);
    expect(carpools[0].name).toBe("Weiss Carpool");

    const theo = store.rows().find((s) => s.last_name === "Ng");
    const nora = store.rows().find((s) => s.last_name === "Chen");
    expect(theo?.carpool_id).toBe(carpools[0].id);
    expect(nora?.carpool_id).toBe(carpools[0].id);
  });

  it("matches an existing carpool by name case-insensitively instead of duplicating it", async () => {
    const { handle, store } = setup();
    const existing = await store.createCarpool({
      name: "Weiss Carpool",
      aliases: [],
    });

    await handle(
      imp([{ first_name: "Theo", last_name: "Ng", carpool: "weiss carpool" }]),
    );

    expect(await store.listCarpools()).toHaveLength(1);
    const theo = store.rows().find((s) => s.last_name === "Ng");
    expect(theo?.carpool_id).toBe(existing.id);
  });

  it("leaves carpool_id null for a row with no carpool column value", async () => {
    const { handle, store } = setup();

    await handle(imp([{ first_name: "Theo", last_name: "Ng" }]));

    const theo = store.rows().find((s) => s.last_name === "Ng");
    expect(theo?.carpool_id).toBeNull();
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
