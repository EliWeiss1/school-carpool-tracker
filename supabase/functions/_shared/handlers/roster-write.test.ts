import { describe, expect, it } from "vitest";

import { createRateLimiter } from "../rate-limit.ts";
import { createFakeStore, makeStudent } from "./fake-store.ts";
import { createRosterWriteHandler } from "./roster-write.ts";

const STAFF_PIN = "4821";

function setup() {
  const store = createFakeStore([
    makeStudent({
      id: "cohen",
      first_name: "Maya",
      last_name: "Cohen",
      aliases: ["Kohen"],
      class_group: "K1",
    }),
  ]);
  const handle = createRosterWriteHandler({
    staffPin: STAFF_PIN,
    rateLimiter: createRateLimiter({ limit: 30, windowMs: 60_000 }),
    pinAttemptLimiter: createRateLimiter({ limit: 10, windowMs: 600_000 }),
    store,
  });
  return { store, handle };
}

const post = (body: unknown) =>
  new Request("https://example.test/roster-write", {
    method: "POST",
    body: JSON.stringify(body),
  });

const base = (overrides: Record<string, unknown> = {}) =>
  post({ pin: STAFF_PIN, deviceId: "office-1", ...overrides });

describe("createRosterWriteHandler — create", () => {
  it("adds a new student, waiting by default", async () => {
    const { handle, store } = setup();

    const response = await handle(
      base({
        first_name: "Theo",
        last_name: "Ng",
        aliases: ["Eng", "Ang"],
        class_group: "K1",
      }),
    );
    const body = (await response.json()) as {
      created: boolean;
      student: { id: string; status: string; aliases: string[] };
    };

    expect(response.status).toBe(200);
    expect(body.created).toBe(true);
    expect(body.student.status).toBe("waiting");
    expect(body.student.aliases).toEqual(["Eng", "Ang"]);
    expect(store.rows()).toHaveLength(2);
  });

  it("accepts parent names on create", async () => {
    const { handle, store } = setup();

    const response = await handle(
      base({
        first_name: "Eli",
        last_name: "Weiss",
        parent1_name: "Dana Weiss",
        parent2_name: "Mark Weiss",
      }),
    );
    const body = (await response.json()) as {
      student: { id: string; parent1_name: string | null; parent2_name: string | null };
    };

    expect(response.status).toBe(200);
    expect(body.student.parent1_name).toBe("Dana Weiss");
    expect(body.student.parent2_name).toBe("Mark Weiss");
    expect(store.row(body.student.id)?.parent1_name).toBe("Dana Weiss");
  });

  it("defaults parent names to null when omitted", async () => {
    const { handle } = setup();

    const response = await handle(base({ first_name: "Theo", last_name: "Ng" }));
    const body = (await response.json()) as {
      student: { parent1_name: string | null; parent2_name: string | null };
    };

    expect(body.student.parent1_name).toBeNull();
    expect(body.student.parent2_name).toBeNull();
  });

  it("defaults aliases and class to empty/null", async () => {
    const { handle } = setup();

    const response = await handle(
      base({ first_name: "New", last_name: "Student" }),
    );
    const body = (await response.json()) as {
      student: { aliases: string[]; class_group: string | null };
    };

    expect(body.student.aliases).toEqual([]);
    expect(body.student.class_group).toBeNull();
  });

  it("drops blank and duplicate aliases", async () => {
    const { handle } = setup();

    const response = await handle(
      base({
        first_name: "New",
        last_name: "Student",
        aliases: ["Smyth", "  ", "smyth", "Smith"],
      }),
    );
    const body = (await response.json()) as { student: { aliases: string[] } };

    expect(body.student.aliases).toEqual(["Smyth", "Smith"]);
  });

  it("requires a first and last name", async () => {
    const { handle, store } = setup();

    const response = await handle(base({ first_name: "", last_name: "Ng" }));

    expect(response.status).toBe(400);
    expect(store.rows()).toHaveLength(1);
  });

  it("requires the staff PIN", async () => {
    const { handle, store } = setup();

    const response = await handle(
      base({ first_name: "Theo", last_name: "Ng", pin: "0000" }),
    );

    expect(response.status).toBe(401);
    expect(store.rows()).toHaveLength(1);
  });
});

describe("createRosterWriteHandler — update", () => {
  it("edits an existing student's name, aliases and class", async () => {
    const { handle, store } = setup();

    const response = await handle(
      base({
        studentId: "cohen",
        first_name: "Maya",
        last_name: "Cohen",
        aliases: ["Kohen", "Cohn"],
        class_group: "1st",
      }),
    );
    const body = (await response.json()) as {
      created: boolean;
      student: { class_group: string | null; aliases: string[] };
    };

    expect(response.status).toBe(200);
    expect(body.created).toBe(false);
    expect(body.student.class_group).toBe("1st");
    expect(body.student.aliases).toEqual(["Kohen", "Cohn"]);
    expect(store.row("cohen")?.class_group).toBe("1st");
  });

  it("only touches fields that were actually sent", async () => {
    const { handle, store } = setup();

    await handle(base({ studentId: "cohen", class_group: "2nd" }));

    expect(store.row("cohen")?.first_name).toBe("Maya");
    expect(store.row("cohen")?.class_group).toBe("2nd");
    expect(store.row("cohen")?.aliases).toEqual(["Kohen"]);
  });

  it("can clear the class back to null", async () => {
    const { handle, store } = setup();

    await handle(base({ studentId: "cohen", class_group: null }));

    expect(store.row("cohen")?.class_group).toBeNull();
  });

  it("sets and then clears a parent name", async () => {
    const { handle, store } = setup();

    await handle(base({ studentId: "cohen", parent1_name: "Rina Cohen" }));
    expect(store.row("cohen")?.parent1_name).toBe("Rina Cohen");

    await handle(base({ studentId: "cohen", parent1_name: null }));
    expect(store.row("cohen")?.parent1_name).toBeNull();
  });

  it("leaves parent names untouched when not sent", async () => {
    const { handle, store } = setup();

    await handle(base({ studentId: "cohen", parent1_name: "Rina Cohen" }));
    await handle(base({ studentId: "cohen", class_group: "2nd" }));

    expect(store.row("cohen")?.parent1_name).toBe("Rina Cohen");
  });

  it("rejects blanking out the last name", async () => {
    const { handle, store } = setup();

    const response = await handle(base({ studentId: "cohen", last_name: "" }));

    expect(response.status).toBe(400);
    expect(store.row("cohen")?.last_name).toBe("Cohen");
  });

  it("says so when the student is not on the roster", async () => {
    const { handle } = setup();

    const response = await handle(
      base({ studentId: "nobody", class_group: "3rd" }),
    );

    expect(response.status).toBe(404);
  });

  it("never lets a caller set status or arrived_at through this endpoint", async () => {
    // Status changes are audited through /set-status and /roster-reset only;
    // this endpoint's input type has no room for either field, so this is a
    // regression guard on that shape rather than a runtime branch.
    const { handle, store } = setup();

    await handle(
      base({ studentId: "cohen", status: "arrived", arrived_at: "now" }),
    );

    expect(store.row("cohen")?.status).toBe("waiting");
    expect(store.row("cohen")?.arrived_at).toBeNull();
  });
});

describe("createRosterWriteHandler — bounds and duplicates", () => {
  it("refuses to add a child who is already on the roster", async () => {
    const { handle, store } = setup();

    const response = await handle(
      base({ first_name: "Maya", last_name: "Cohen" }),
    );

    expect(response.status).toBe(409);
    expect(store.rows()).toHaveLength(1);
  });

  it("compares those names case-insensitively", async () => {
    const { handle } = setup();

    const response = await handle(
      base({ first_name: "MAYA", last_name: "cohen" }),
    );

    expect(response.status).toBe(409);
  });

  it("still lets an existing student be edited without tripping the check", async () => {
    const { handle } = setup();

    const response = await handle(
      base({
        studentId: "cohen",
        first_name: "Maya",
        last_name: "Cohen",
        class_group: "1st",
      }),
    );

    expect(response.status).toBe(200);
  });

  it("rejects a name too long to be a name", async () => {
    const { handle, store } = setup();

    const response = await handle(
      base({ first_name: "Theo", last_name: "N".repeat(400) }),
    );

    expect(response.status).toBe(400);
    expect(store.rows()).toHaveLength(1);
  });
});
