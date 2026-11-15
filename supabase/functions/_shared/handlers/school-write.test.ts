import { describe, expect, it } from "vitest";

import { createRateLimiter } from "../rate-limit.ts";
import { createFakeAccess } from "./fake-access.ts";
import { createFakeUsage } from "./fake-usage.ts";
import { createFakeSchoolStore } from "./fake-school-store.ts";
import { createSchoolWriteHandler } from "./school-write.ts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const OWNER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DEVICE_A = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const NEWBIE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const UNCONFIRMED = "ffffffff-ffff-4fff-8fff-ffffffffffff";

function setup() {
  const access = createFakeAccess();
  access.addUser("owner-a", { userId: OWNER_A });
  access.addUser("owner-b", { userId: OWNER_B });
  access.addUser("device-a", { userId: DEVICE_A, isAnonymous: true });
  access.addUser("newbie", { userId: NEWBIE });
  access.addUser("unconfirmed", { userId: UNCONFIRMED, emailConfirmed: false });
  access.grant(OWNER_A, A, { kind: "member", role: "owner" });
  access.grant(OWNER_B, B, { kind: "member", role: "owner" });
  access.grant(DEVICE_A, A, {
    kind: "device",
    canAnnounce: true,
    canDisplay: true,
  });

  const schools = createFakeSchoolStore();
  schools.seedSchool(
    { id: A, slug: "maple", name: "Maple" },
    { announceCode: "AAAAAA1", displayCode: "AAAAAA2" },
    OWNER_A,
  );
  schools.seedSchool(
    { id: B, slug: "oak", name: "Oak" },
    { announceCode: "BBBBBB1", displayCode: "BBBBBB2" },
    OWNER_B,
  );
  schools.seedDevice({
    id: "row-a1",
    schoolId: A,
    userId: "a1-user",
    canAnnounce: true,
    label: "A phone",
  });
  schools.seedDevice({
    id: "row-b1",
    schoolId: B,
    userId: "b1-user",
    canDisplay: true,
    label: "B tv",
  });

  const usage = createFakeUsage();
  usage.configure(A, { used: 7, limit: 100, enabled: true });
  usage.configure(B, { used: 900, limit: 1000, enabled: false });

  const handle = createSchoolWriteHandler({
    access,
    schools,
    usage,
    rateLimiter: createRateLimiter({ limit: 100, windowMs: 60_000 }),
  });
  return { access, schools, usage, handle };
}

const post = (body: unknown, token: string | null = "owner-a") =>
  new Request("https://example.test/school-write", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: JSON.stringify(body),
  });

const office = (action: string, extra: Record<string, unknown> = {}) =>
  post({ action, schoolId: A, deviceId: "office-1", ...extra });

const create = (extra: Record<string, unknown> = {}) => ({
  action: "create",
  name: "Elm School",
  slug: "elm-school",
  timezone: "America/Chicago",
  deviceId: "d",
  ...extra,
});

describe("school-write — create", () => {
  it("creates a school for a confirmed office account", async () => {
    const { handle, schools } = setup();
    const res = await handle(post(create(), "newbie"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.created).toBe(true);
    expect(json.school).toMatchObject({
      name: "Elm School",
      slug: "elm-school",
      timezone: "America/Chicago",
    });
    expect(schools.schoolOf(json.school.id)).toBeDefined();
  });

  it("returns the account's existing school with created: false", async () => {
    const { handle } = setup();
    const res = await handle(post(create({ slug: "another-one" }), "owner-a"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.created).toBe(false);
    expect(json.school.id).toBe(A);
  });

  it("answers 409 for a taken web address", async () => {
    const { handle } = setup();
    const res = await handle(post(create({ slug: "oak" }), "newbie"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(
      "That web address is taken. Try another.",
    );
  });

  it("refuses a device session", async () => {
    const { handle } = setup();
    const res = await handle(post(create(), "device-a"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(
      "Sign in with an office account to create a school.",
    );
  });

  it("refuses an unconfirmed email", async () => {
    const { handle } = setup();
    const res = await handle(post(create(), "unconfirmed"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(
      "Confirm your email address first. Check your inbox for the link.",
    );
  });

  it.each([
    ["name", { name: "  " }],
    ["slug", { slug: "Not A Slug" }],
    ["timezone", { timezone: "Mars/Olympus" }],
  ])("refuses an invalid %s with a sentence", async (_field, bad) => {
    const { handle, schools } = setup();
    const res = await handle(post(create(bad), "newbie"));
    expect(res.status).toBe(400);
    expect(typeof (await res.json()).error).toBe("string");
    expect(schools.schoolOf("anything")).toBeUndefined();
  });

  it("needs a session", async () => {
    const { handle } = setup();
    expect((await handle(post(create(), null))).status).toBe(401);
  });
});

describe("school-write — update-settings", () => {
  it("updates only what was sent and returns the settings", async () => {
    const { handle, schools } = setup();
    const res = await handle(
      office("update-settings", {
        name: " Maple Academy ",
        resetHour: 19,
        resetDays: [1, 2],
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).school).toEqual({
      id: A,
      name: "Maple Academy",
      slug: "maple",
      timezone: "UTC",
      resetHour: 19,
      resetDays: [1, 2],
    });
    expect(schools.schoolOf(A)?.slug).toBe("maple");
  });

  it("needs at least one setting", async () => {
    const { handle } = setup();
    expect((await handle(office("update-settings"))).status).toBe(400);
  });

  it.each([
    { name: "" },
    { timezone: "Nope/Nope" },
    { resetHour: 24 },
    { resetDays: [1, 1] },
  ])("refuses an invalid value %j", async (bad) => {
    const { handle } = setup();
    const res = await handle(office("update-settings", bad));
    expect(res.status).toBe(400);
  });

  it("ignores slug and id fields in the body", async () => {
    const { handle, schools } = setup();
    await handle(
      office("update-settings", { name: "New", slug: "hijack", id: B }),
    );
    expect(schools.schoolOf(A)?.slug).toBe("maple");
    expect(schools.schoolOf(B)?.name).toBe("Oak");
  });
});

describe("school-write — codes", () => {
  it("gets both codes", async () => {
    const { handle } = setup();
    const res = await handle(office("get-codes"));
    expect(await res.json()).toEqual({
      announceCode: "AAAAAA1",
      displayCode: "AAAAAA2",
    });
  });

  it("sets a code, normalised, without disconnecting by default", async () => {
    const { handle, schools } = setup();
    const res = await handle(
      office("set-code", { which: "announce", code: "new-code 9" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      announceCode: "NEWCODE9",
      displayCode: "AAAAAA2",
      disconnected: 0,
    });
    expect(schools.devices(A)).toHaveLength(1);
  });

  it("clears a code with null", async () => {
    const { handle } = setup();
    const res = await handle(
      office("set-code", { which: "display", code: null }),
    );
    expect((await res.json()).displayCode).toBeNull();
  });

  it("disconnects devices and deletes their sessions when asked", async () => {
    const { handle, schools } = setup();
    const res = await handle(
      office("set-code", {
        which: "announce",
        code: "FRESH123",
        disconnectDevices: true,
      }),
    );
    expect((await res.json()).disconnected).toBe(1);
    expect(schools.devices(A)).toHaveLength(0);
    expect(schools.deletedUserIds).toEqual(["a1-user"]);
    // School B's device is untouched.
    expect(schools.devices(B)).toHaveLength(1);
  });

  it("still succeeds when deleting the auth users fails", async () => {
    const { handle, schools } = setup();
    schools.failDeletingUsers();
    const res = await handle(
      office("set-code", {
        which: "both",
        code: "FRESH123",
        disconnectDevices: true,
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).disconnected).toBe(1);
  });

  it("never deletes a non-anonymous user the store is handed", async () => {
    const { schools } = setup();
    const deleted = await schools.deleteDeviceUsers([OWNER_A]);
    expect(deleted).toBe(0);
    expect(schools.deletedUserIds).toEqual([]);
  });

  it.each([null, undefined, "abc", "a".repeat(21), "bad code!", 123456])(
    "refuses the invalid code %j",
    async (code) => {
      const { handle } = setup();
      const res = await handle(office("set-code", { which: "both", code }));
      // null is a valid clear; everything else is a 400.
      if (code === null) expect(res.status).toBe(200);
      else {
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe(
          "Use 6 to 20 letters and numbers for the code.",
        );
      }
    },
  );

  it("refuses an unknown capability", async () => {
    const { handle } = setup();
    const res = await handle(
      office("set-code", { which: "everything", code: "ABCDEF" }),
    );
    expect(res.status).toBe(400);
  });
});

describe("school-write — devices", () => {
  it("lists this school's devices without user ids", async () => {
    const { handle } = setup();
    const res = await handle(office("list-devices"));
    const text = await res.text();
    const json = JSON.parse(text);
    expect(json.devices).toHaveLength(1);
    expect(json.devices[0]).toMatchObject({
      id: "row-a1",
      label: "A phone",
      canAnnounce: true,
      canDisplay: false,
    });
    expect(text).not.toContain("a1-user");
    expect(text).not.toContain("userId");
  });

  it("disconnects a device", async () => {
    const { handle, schools } = setup();
    const res = await handle(
      office("disconnect-device", { deviceRowId: "row-a1" }),
    );
    expect(await res.json()).toEqual({ disconnected: true });
    expect(schools.devices(A)).toHaveLength(0);
  });

  it("ends the disconnected device's session too", async () => {
    const { handle, schools } = setup();
    await handle(office("disconnect-device", { deviceRowId: "row-a1" }));
    expect(schools.deletedUserIds).toEqual(["a1-user"]);
  });

  it("still disconnects when the session cannot be deleted", async () => {
    const { handle, schools } = setup();
    schools.failDeletingUsers();
    const res = await handle(
      office("disconnect-device", { deviceRowId: "row-a1" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ disconnected: true });
    expect(schools.devices(A)).toHaveLength(0);
  });

  it("deletes no session when the row belongs to another school", async () => {
    const { handle, schools } = setup();
    await handle(office("disconnect-device", { deviceRowId: "row-b1" }));
    expect(schools.deletedUserIds).toEqual([]);
  });

  it("answers false for another school's device row, and removes nothing", async () => {
    const { handle, schools } = setup();
    const res = await handle(
      office("disconnect-device", { deviceRowId: "row-b1" }),
    );
    expect(await res.json()).toEqual({ disconnected: false });
    expect(schools.devices(B)).toHaveLength(1);
  });

  it("needs a device row id", async () => {
    const { handle } = setup();
    expect((await handle(office("disconnect-device"))).status).toBe(400);
  });
});

describe("school-write — isolation and access", () => {
  const actions: [string, Record<string, unknown>][] = [
    ["update-settings", { name: "Hijacked" }],
    ["get-codes", {}],
    ["set-code", { which: "both", code: "HIJACK99", disconnectDevices: true }],
    ["list-devices", {}],
    ["disconnect-device", { deviceRowId: "row-a1" }],
    ["voice-usage", {}],
  ];

  it.each(actions)(
    "a member of school A is refused %s on school B",
    async (action, extra) => {
      const { handle, schools } = setup();
      const res = await handle(
        post({ action, schoolId: B, deviceId: "x", ...extra }, "owner-a"),
      );
      expect(res.status).toBe(403);
      expect(schools.schoolOf(B)).toMatchObject({
        name: "Oak",
        announceCode: "BBBBBB1",
        displayCode: "BBBBBB2",
      });
      expect(schools.devices(B)).toHaveLength(1);
    },
  );

  it("school B's own id in other body fields reaches nothing of B's", async () => {
    const { handle, schools } = setup();
    const res = await handle(
      post(
        {
          action: "set-code",
          schoolId: A,
          targetSchoolId: B,
          school_id: B,
          id: B,
          which: "both",
          code: "OWNED123",
          deviceId: "x",
        },
        "owner-a",
      ),
    );
    expect(res.status).toBe(200);
    expect(schools.schoolOf(B)?.announceCode).toBe("BBBBBB1");
    expect(schools.schoolOf(A)?.announceCode).toBe("OWNED123");
  });

  it.each(actions)("a paired device gets 403 on %s", async (action, extra) => {
    const { handle, schools } = setup();
    const res = await handle(
      post({ action, schoolId: A, deviceId: "x", ...extra }, "device-a"),
    );
    expect(res.status).toBe(403);
    expect(schools.schoolOf(A)?.announceCode).toBe("AAAAAA1");
    expect(schools.devices(A)).toHaveLength(1);
  });

  it("needs a session for office actions", async () => {
    const { handle } = setup();
    expect(
      (await handle(post({ action: "get-codes", schoolId: A }, null))).status,
    ).toBe(401);
  });

  it("gives the staff PIN nothing, on any action", async () => {
    const { handle } = setup();
    for (const action of ["create", "get-codes", "set-code"]) {
      const res = await handle(
        post({ ...create(), action, schoolId: A, pin: "4821" }, null),
      );
      expect(res.status).toBe(401);
    }
  });

  it("refuses an unknown action after authenticating", async () => {
    const { handle } = setup();
    expect((await handle(office("explode"))).status).toBe(400);
    expect(
      (await handle(post({ action: "explode", schoolId: A }, null))).status,
    ).toBe(401);
  });

  it("answers preflight and rejects GET", async () => {
    const { handle } = setup();
    const options = await handle(
      new Request("https://example.test/school-write", { method: "OPTIONS" }),
    );
    expect(options.status).toBe(204);
    const get = await handle(
      new Request("https://example.test/school-write", { method: "GET" }),
    );
    expect(get.status).toBe(405);
  });
});
