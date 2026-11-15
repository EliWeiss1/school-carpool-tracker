/**
 * Two schools, identical in every name, sharing one deployment: nothing either
 * one does may read, change or reveal anything of the other's.
 *
 * Names are identical on purpose. A leak that depended on names differing would
 * be caught by a name collision in production and never here; identical names
 * leave ids (and a canary parent name) as the only thing telling the schools
 * apart, which is exactly the situation a missed `school_id` filter creates.
 */

import { describe, expect, it } from "vitest";

import type { RosterStore } from "../ports.ts";
import { createRateLimiter } from "../rate-limit.ts";
import { createCarpoolWriteHandler } from "./carpool-write.ts";
import { createClassesWriteHandler } from "./classes-write.ts";
import { createFakeAccess } from "./fake-access.ts";
import { createFakeUsage } from "./fake-usage.ts";
import {
  createFakeStores,
  makeCarpool,
  makeClassGroup,
  makeStudent,
  type FakeStore,
} from "./fake-store.ts";
import { createResolveHandler } from "./resolve.ts";
import { createRosterDeleteHandler } from "./roster-delete.ts";
import { createRosterImportHandler } from "./roster-import.ts";
import { createRosterListHandler } from "./roster-list.ts";
import { createRosterResetHandler } from "./roster-reset.ts";
import { createRosterWriteHandler } from "./roster-write.ts";
import { createStatusHandler } from "./status.ts";
import { createTokenHandler } from "./token.ts";

const SCHOOL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SCHOOL_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const OFFICE_A = "token-office-a";
const OFFICE_B = "token-office-b";
const CURB_A = "token-curb-a";

/** Only ever on B's rows, so it appearing in a response is proof of a leak. */
const CANARY = "Parent of B only";

interface SchoolIds {
  maya: string;
  aaron: string;
  noah: string;
  carpool: string;
  third: string;
  chess: string;
}

/** The same roster for every school: same names, different ids. */
function seedFor(parentName: string) {
  const carpool = makeCarpool({ name: "Cohen carpool" });
  const third = makeClassGroup({ name: "3rd" });
  const chess = makeClassGroup({ name: "Chess" });
  const maya = makeStudent({
    first_name: "Maya",
    last_name: "Cohen",
    class_groups: ["3rd", "Chess"],
    carpool_id: carpool.id,
    parent1_name: parentName,
  });
  const aaron = makeStudent({
    first_name: "Aaron",
    last_name: "Cohen",
    class_groups: ["3rd"],
    carpool_id: carpool.id,
    parent1_name: parentName,
  });
  const noah = makeStudent({
    first_name: "Noah",
    last_name: "Levi",
    class_groups: ["Chess"],
    status: "arrived",
    arrived_at: "2026-09-02T13:00:00.000Z",
    parent1_name: parentName,
  });
  const ids: SchoolIds = {
    maya: maya.id,
    aaron: aaron.id,
    noah: noah.id,
    carpool: carpool.id,
    third: third.id,
    chess: chess.id,
  };
  return {
    seed: {
      students: [maya, aaron, noah],
      carpools: [carpool],
      classGroups: [third, chess],
    },
    ids,
  };
}

function world() {
  const a = seedFor("Parent of A");
  const b = seedFor(CANARY);
  const stores = createFakeStores({ [SCHOOL_A]: a.seed, [SCHOOL_B]: b.seed });

  const access = createFakeAccess();
  access.addUser(OFFICE_A, { userId: "office-a" });
  access.grant("office-a", SCHOOL_A, { kind: "member", role: "owner" });
  access.addUser(OFFICE_B, { userId: "office-b" });
  access.grant("office-b", SCHOOL_B, { kind: "member", role: "owner" });
  access.addUser(CURB_A, { userId: "curb-a", isAnonymous: true });
  access.grant("curb-a", SCHOOL_A, {
    kind: "device",
    canAnnounce: true,
    canDisplay: true,
  });

  // Limits are generous: this file is about who can see what, not throttling.
  const common = {
    staffPin: "4821",
    rateLimiter: createRateLimiter({ limit: 10_000, windowMs: 60_000 }),
    pinAttemptLimiter: createRateLimiter({ limit: 10_000, windowMs: 600_000 }),
    access,
    stores,
  };

  const handlers = {
    "deepgram-token": createTokenHandler({
      ...common,
      usage: createFakeUsage(),
      mintToken: () => Promise.resolve({ token: "dg_temp", expiresIn: 300 }),
    }),
    "resolve-name": createResolveHandler(common),
    "set-status": createStatusHandler(common),
    "roster-list": createRosterListHandler(common),
    "roster-write": createRosterWriteHandler(common),
    "roster-delete": createRosterDeleteHandler(common),
    "roster-import": createRosterImportHandler(common),
    "roster-reset": createRosterResetHandler(common),
    "carpool-write": createCarpoolWriteHandler(common),
    "classes-write": createClassesWriteHandler(common),
  };

  return { a, b, stores, handlers };
}

type World = ReturnType<typeof world>;
type Endpoint = keyof World["handlers"];

const OFFICE_ENDPOINTS: Endpoint[] = [
  "roster-list",
  "roster-write",
  "roster-delete",
  "roster-import",
  "roster-reset",
  "carpool-write",
  "classes-write",
];

function call(
  w: World,
  endpoint: Endpoint,
  token: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return w.handlers[endpoint](
    new Request(`https://example.test/${endpoint}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ deviceId: "test-device", ...body }),
    }),
  );
}

/** Everything a school holds, as one comparable string. */
async function snapshot(store: FakeStore): Promise<string> {
  return JSON.stringify({
    rows: store.rows(),
    carpools: store.carpoolRows(),
    classes: store.classGroupRows(),
    events: store.events,
    counts: await store.countClassMembers(),
  });
}

/** Every `id` property of every object in a JSON value, however deep. */
function objectIds(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) objectIds(item, out);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      if (key === "id" && typeof child === "string") out.push(child);
      else objectIds(child, out);
    }
  }
  return out;
}

function bIdSet(b: SchoolIds): Set<string> {
  return new Set(Object.values(b));
}

function expectNothingOfB(json: unknown, b: SchoolIds): void {
  expect(JSON.stringify(json)).not.toContain(CANARY);
  const leaked = objectIds(json).filter((id) => bIdSet(b).has(id));
  expect(leaked).toEqual([]);
}

describe("store contract: a RosterStore is exactly one school", () => {
  it("never reads or changes the other school, even when handed its ids", async () => {
    const w = world();
    const storeA = w.stores.forSchool(SCHOOL_A);
    const storeB = w.stores.forSchool(SCHOOL_B);
    const before = await snapshot(storeB);
    const b = w.b.ids;
    const returned: unknown[] = [];
    const keep = <T>(value: T): T => {
      returned.push(value);
      return value;
    };

    // Every RosterStore method, in interface order. Anything that names an
    // id takes one of B's.
    keep(await storeA.list({}));
    keep(await storeA.list({ classGroups: ["3rd"] }));
    expect(await storeA.get(b.maya)).toBeNull();
    expect(await storeA.setStatus(b.maya, "arrived")).toBeNull();
    expect(await storeA.setStatusMany([b.maya, b.aaron], "arrived")).toEqual(
      [],
    );
    expect(await storeA.setStatusMany([b.noah], "waiting")).toEqual([]);
    expect(
      await storeA.logEvent({
        studentId: b.maya,
        changedTo: "arrived",
        source: "manual",
        matchConfidence: null,
        rawTranscript: null,
        carpoolId: b.carpool,
      }),
    ).toBe(true);
    keep(
      await storeA.createStudent({
        first_name: "Zed",
        last_name: "Only",
        aliases: [],
        class_group_ids: [],
        carpool_id: null,
        parent1_name: null,
        parent2_name: null,
      }),
    );
    await expect(
      storeA.createStudent({
        first_name: "Zed",
        last_name: "Cross",
        aliases: [],
        class_group_ids: [b.third],
        carpool_id: null,
        parent1_name: null,
        parent2_name: null,
      }),
    ).rejects.toThrow();
    expect(
      await storeA.updateStudent(b.maya, { last_name: "Hacked" }),
    ).toBeNull();
    expect(await storeA.removeStudents([b.maya, b.aaron, b.noah])).toEqual([]);
    keep(
      await storeA.bulkCreateStudents([
        {
          first_name: "Pia",
          last_name: "Only",
          aliases: [],
          class_group_ids: [],
          carpool_id: null,
          parent1_name: null,
          parent2_name: null,
        },
      ]),
    );
    keep(await storeA.resetAllToWaiting());

    keep(await storeA.listCarpools());
    keep(await storeA.createCarpool({ name: "Cohen carpool", aliases: [] }));
    expect(
      await storeA.updateCarpool(b.carpool, { name: "Hacked" }),
    ).toBeNull();
    expect(await storeA.removeCarpool(b.carpool)).toBe(false);
    expect(await storeA.setCarpoolMembers(b.carpool, [b.maya])).toEqual([]);
    expect(await storeA.setCarpoolMembers(null, [b.maya, b.aaron])).toEqual([]);

    keep(await storeA.listClassGroups());
    keep(await storeA.createClassGroup({ name: "3rd" }));
    expect(await storeA.removeClassGroup(b.third)).toEqual({
      status: "not-found",
    });
    expect(
      await storeA.removeClassGroup(w.a.ids.third, { moveToClassId: b.chess }),
    ).toEqual({ status: "bad-target" });
    expect(await storeA.changeClassMembers(b.third, [b.maya], [])).toBeNull();
    const changed = await storeA.changeClassMembers(
      w.a.ids.third,
      [b.maya],
      [b.aaron],
    );
    // The only place a foreign id may appear: echoed back as "not on the roster".
    expect(changed?.ignoredIds.sort()).toEqual([b.aaron, b.maya].sort());
    keep(await storeA.countClassMembers());
    keep(await storeA.reorderClassGroups([b.chess, b.third]));

    expect(await snapshot(storeB)).toBe(before);
    for (const value of returned) expectNothingOfB(value, b);
  });

  it("covers every method of RosterStore (so a new one cannot skip this file)", () => {
    const methods: (keyof RosterStore)[] = [
      "list", "get", "setStatus", "setStatusMany", "logEvent", "createStudent",
      "updateStudent", "removeStudents", "bulkCreateStudents", "resetAllToWaiting",
      "listCarpools", "createCarpool", "updateCarpool", "removeCarpool",
      "setCarpoolMembers", "listClassGroups", "createClassGroup",
      "removeClassGroup", "changeClassMembers", "countClassMembers",
      "reorderClassGroups",
    ]; // prettier-ignore
    const store = world().stores.forSchool(SCHOOL_A);
    // The fake exposes every RosterStore method and nothing else but its test
    // inspectors, so adding a method to the port fails here until it is listed.
    for (const method of methods) expect(typeof store[method]).toBe("function");
    const inspectors = [
      "events",
      "rows",
      "row",
      "carpoolRows",
      "classGroupRows",
    ];
    expect(Object.keys(store).sort()).toEqual(
      [...methods, ...inspectors].sort(),
    );
  });
});

describe("handlers: A's office token cannot reach B", () => {
  it("every endpoint, naming B's ids, leaves B untouched and reveals nothing of it", async () => {
    const w = world();
    const storeB = w.stores.forSchool(SCHOOL_B);
    const before = await snapshot(storeB);
    const b = w.b.ids;
    const a = w.a.ids;
    const asA = { schoolId: SCHOOL_A };

    const requests: [Endpoint, Record<string, unknown>][] = [
      ["deepgram-token", { ...asA }],
      ["resolve-name", { ...asA, transcript: "Cohen" }],
      [
        "set-status",
        { ...asA, studentIds: [b.maya, b.noah], status: "waiting", source: "manual" },
      ],
      [
        "set-status",
        {
          ...asA,
          studentId: b.maya,
          status: "arrived",
          source: "voice",
          carpoolId: b.carpool,
        },
      ],
      ["roster-list", { ...asA }],
      ["roster-write", { ...asA, studentId: b.maya, last_name: "Hacked" }],
      [
        "roster-write",
        { ...asA, first_name: "Zed", last_name: "Only", carpool_id: b.carpool },
      ],
      ["roster-delete", { ...asA, studentIds: [b.maya, b.aaron, b.noah] }],
      [
        "roster-import",
        {
          ...asA,
          students: [
            { first_name: "Pia", last_name: "Only", aliases: [], class_groups: ["3rd"], carpool: "Cohen carpool" },
          ],
        },
      ],
      ["roster-reset", { ...asA }],
      ["carpool-write", { ...asA, action: "update", carpoolId: b.carpool, name: "Hacked" }],
      ["carpool-write", { ...asA, action: "delete", carpoolId: b.carpool }],
      [
        "carpool-write",
        { ...asA, action: "create", name: "New carpool", memberIds: [b.maya, b.aaron] },
      ],
      [
        "carpool-write",
        { ...asA, action: "update", carpoolId: a.carpool, memberIds: [b.maya] },
      ],
      ["classes-write", { ...asA, action: "delete", classId: b.third, force: true }],
      [
        "classes-write",
        { ...asA, action: "delete", classId: a.third, moveToClassId: b.chess },
      ],
      [
        "classes-write",
        { ...asA, action: "members", classId: b.third, addStudentIds: [b.maya], removeStudentIds: [] },
      ],
      [
        "classes-write",
        { ...asA, action: "members", classId: a.third, addStudentIds: [], removeStudentIds: [b.maya] },
      ],
      ["classes-write", { ...asA, action: "reorder", orderedIds: [b.chess, b.third] }],
      ["classes-write", { ...asA, action: "create", name: "Debate" }],
    ]; // prettier-ignore

    // All ten endpoints are in play, not just most of them.
    expect(new Set(requests.map(([endpoint]) => endpoint))).toEqual(
      new Set(Object.keys(w.handlers)),
    );

    for (const [endpoint, body] of requests) {
      const response = await call(w, endpoint, OFFICE_A, body);
      const text = await response.text();
      const json: unknown = text === "" ? null : JSON.parse(text);

      // Foreign ids echoed back as "not found" are the request's own words;
      // what must never come back is a B row.
      expectNothingOfB(json, b);
      expect(await snapshot(storeB), `${endpoint} ${text}`).toBe(before);
    }
  });

  it("refuses a request that carries B's schoolId alongside A's token", async () => {
    const w = world();
    const storeB = w.stores.forSchool(SCHOOL_B);
    const before = await snapshot(storeB);
    const storeA = w.stores.forSchool(SCHOOL_A);
    const beforeA = await snapshot(storeA);

    const bodies: Record<Endpoint, Record<string, unknown>> = {
      "deepgram-token": {},
      "resolve-name": { transcript: "Cohen" },
      "set-status": { studentId: w.b.ids.maya, status: "arrived", source: "manual" },
      "roster-list": {},
      "roster-write": { first_name: "Zed", last_name: "Only" },
      "roster-delete": { studentIds: [w.b.ids.maya] },
      "roster-import": { students: [{ first_name: "Pia", last_name: "Only" }] },
      "roster-reset": {},
      "carpool-write": { action: "delete", carpoolId: w.b.ids.carpool },
      "classes-write": { action: "delete", classId: w.b.ids.third, force: true },
    }; // prettier-ignore

    for (const endpoint of Object.keys(bodies) as Endpoint[]) {
      const response = await call(w, endpoint, OFFICE_A, {
        schoolId: SCHOOL_B,
        ...bodies[endpoint],
      });
      expect(response.status, endpoint).toBe(403);
      expectNothingOfB(await response.json(), w.b.ids);
    }
    expect(await snapshot(storeB)).toBe(before);
    expect(await snapshot(storeA)).toBe(beforeA);
  });

  it("does not let a staff PIN holder name another school either", async () => {
    const w = world();
    const storeB = w.stores.forSchool(SCHOOL_B);
    const before = await snapshot(storeB);

    // A PIN always means the legacy school, which here holds no rows; the
    // body's schoolId must not redirect it to B.
    const response = await w.handlers["roster-list"](
      new Request("https://example.test/roster-list", {
        method: "POST",
        body: JSON.stringify({ pin: "4821", schoolId: SCHOOL_B }),
      }),
    );
    const json = (await response.json()) as { students: unknown[] };
    expect(response.status).toBe(200);
    expect(json.students).toEqual([]);
    expect(await snapshot(storeB)).toBe(before);
  });
});

describe("handlers: a curb device is announce-only", () => {
  it("can use token, resolve and status in its own school", async () => {
    const w = world();
    const asA = { schoolId: SCHOOL_A };

    const token = await call(w, "deepgram-token", CURB_A, asA);
    expect(token.status).toBe(200);
    expectNothingOfB(await token.json(), w.b.ids);

    const resolve = await call(w, "resolve-name", CURB_A, {
      ...asA,
      transcript: "Cohen",
    });
    expect(resolve.status).toBe(200);
    const resolved = await resolve.json();
    expect(objectIds(resolved).length).toBeGreaterThan(0);
    expectNothingOfB(resolved, w.b.ids);

    const status = await call(w, "set-status", CURB_A, {
      ...asA,
      studentId: w.a.ids.maya,
      status: "arrived",
      source: "manual",
    });
    expect(status.status).toBe(200);
    expect(w.stores.forSchool(SCHOOL_A).row(w.a.ids.maya)?.status).toBe(
      "arrived",
    );
    expect(w.stores.forSchool(SCHOOL_B).row(w.b.ids.maya)?.status).toBe(
      "waiting",
    );
  });

  it("is refused by all seven office endpoints", async () => {
    const w = world();
    const before = await snapshot(w.stores.forSchool(SCHOOL_A));

    expect(OFFICE_ENDPOINTS).toHaveLength(7);
    for (const endpoint of OFFICE_ENDPOINTS) {
      const response = await call(w, endpoint, CURB_A, {
        schoolId: SCHOOL_A,
        action: "delete",
        studentIds: [w.a.ids.maya],
        carpoolId: w.a.ids.carpool,
        classId: w.a.ids.third,
        first_name: "Zed",
        last_name: "Only",
        students: [{ first_name: "Pia", last_name: "Only" }],
      });
      expect(response.status, endpoint).toBe(403);
    }
    expect(await snapshot(w.stores.forSchool(SCHOOL_A))).toBe(before);
  });
});

describe("handlers: the duplicate-student check is per school", () => {
  /** Priya is on A's roster and not on B's. */
  async function twoSchoolsOneChild() {
    const w = world();
    await w.stores.forSchool(SCHOOL_A).createStudent({
      first_name: "Priya",
      last_name: "Shah",
      aliases: [],
      class_group_ids: [],
      carpool_id: null,
      parent1_name: null,
      parent2_name: null,
    });
    return { w };
  }

  it("roster-write: allowed in B when A has the name, refused within A and within B", async () => {
    const { w } = await twoSchoolsOneChild();
    const add = (token: string, schoolId: string) =>
      call(w, "roster-write", token, {
        schoolId,
        first_name: "Priya",
        last_name: "Shah",
      });

    expect((await add(OFFICE_A, SCHOOL_A)).status).toBe(409);
    expect((await add(OFFICE_B, SCHOOL_B)).status).toBe(200);
    expect((await add(OFFICE_B, SCHOOL_B)).status).toBe(409);
    expect((await add(OFFICE_A, SCHOOL_A)).status).toBe(409);
  });

  it("roster-import: allowed in B when A has the name, refused within A", async () => {
    const { w } = await twoSchoolsOneChild();
    const imp = (token: string, schoolId: string) =>
      call(w, "roster-import", token, {
        schoolId,
        students: [{ first_name: "Priya", last_name: "Shah", aliases: [] }],
      });

    expect((await imp(OFFICE_A, SCHOOL_A)).status).toBe(409);
    expect((await imp(OFFICE_B, SCHOOL_B)).status).toBe(200);
    expect((await imp(OFFICE_B, SCHOOL_B)).status).toBe(409);
  });
});
