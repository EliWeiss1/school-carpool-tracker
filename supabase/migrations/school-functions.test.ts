import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BOOTSTRAP, asRoleOn, insertAuthUser } from "./test-bootstrap";

/**
 * The school functions the pair-device and school-write Edge Functions call,
 * tested by running them: school creation, the atomic wrong-code counter,
 * code changes with optional disconnect, and device pairing.
 */

const DIR = dirname(fileURLToPath(import.meta.url));

let db: PGlite;

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(BOOTSTRAP);
  for (const file of readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(join(DIR, file), "utf8"));
  }
});

afterAll(async () => {
  await db.close();
});

interface Json {
  [key: string]: unknown;
}

async function call(sql: string, params: unknown[] = []): Promise<Json> {
  const res = await db.query<{ r: Json }>(`select ${sql} as r`, params);
  return res.rows[0].r;
}

async function rows<T extends object>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

let counter = 0;
const slug = () => `school-fn-${++counter}`;

async function newSchool(): Promise<string> {
  const user = await insertAuthUser(db, { email: `o${counter}@x.test` });
  const res = await call("public.create_school($1, 'Test', $2, 'UTC')", [
    user,
    slug(),
  ]);
  return (res.school as Json).id as string;
}

describe("create_school", () => {
  it("creates the school, its secrets row and the owner membership", async () => {
    const user = await insertAuthUser(db, { email: "a@x.test" });
    const s = slug();
    const res = await call(
      "public.create_school($1, 'Maple School', $2, 'America/Chicago')",
      [user, s],
    );
    expect(res.status).toBe("created");
    const school = res.school as Json;
    expect(school).toMatchObject({
      name: "Maple School",
      slug: s,
      timezone: "America/Chicago",
    });

    const id = school.id as string;
    const [row] = await rows<{ voice_enabled: boolean; limit: number }>(
      "select voice_enabled, voice_monthly_limit as limit from public.schools where id = $1",
      [id],
    );
    expect(row.voice_enabled).toBe(true);
    expect(row.limit).toBe(1000);
    expect(
      await rows(
        "select 1 from public.school_secrets where school_id = $1 and announce_code is null and display_code is null",
        [id],
      ),
    ).toHaveLength(1);
    expect(
      await rows<{ role: string }>(
        "select role from public.school_members where school_id = $1 and user_id = $2",
        [id, user],
      ),
    ).toEqual([{ role: "owner" }]);
  });

  it("returns the existing school and creates nothing for a user who has one", async () => {
    const user = await insertAuthUser(db, { email: "b@x.test" });
    const first = await call("public.create_school($1, 'One', $2, 'UTC')", [
      user,
      slug(),
    ]);
    const before = await rows("select 1 from public.schools");
    const second = await call("public.create_school($1, 'Two', $2, 'UTC')", [
      user,
      slug(),
    ]);
    expect(second.status).toBe("exists");
    expect((second.school as Json).id).toBe((first.school as Json).id);
    expect(await rows("select 1 from public.schools")).toHaveLength(
      before.length,
    );
  });

  it("reports a taken slug and leaves nothing behind", async () => {
    const a = await insertAuthUser(db, { email: "c@x.test" });
    const b = await insertAuthUser(db, { email: "d@x.test" });
    const s = slug();
    await call("public.create_school($1, 'First', $2, 'UTC')", [a, s]);
    const res = await call("public.create_school($1, 'Second', $2, 'UTC')", [
      b,
      s,
    ]);
    expect(res).toEqual({ status: "slug-taken" });
    expect(
      await rows("select 1 from public.school_members where user_id = $1", [b]),
    ).toHaveLength(0);
  });

  it("lets only one of two concurrent creations of a slug win", async () => {
    const a = await insertAuthUser(db, { email: "e@x.test" });
    const b = await insertAuthUser(db, { email: "f@x.test" });
    const s = slug();
    const results = await Promise.all([
      call("public.create_school($1, 'A', $2, 'UTC')", [a, s]),
      call("public.create_school($1, 'B', $2, 'UTC')", [b, s]),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual(["created", "slug-taken"]);
  });
});

describe("note_pair_failure", () => {
  const T0 = "2026-11-13T12:00:00Z";
  const at = (minutes: number) =>
    new Date(Date.parse(T0) + minutes * 60_000).toISOString();

  it("counts within a window and locks on the tenth wrong code", async () => {
    const id = await newSchool();
    for (let i = 1; i <= 9; i++) {
      const res = await call("public.note_pair_failure($1, $2)", [
        id,
        at(i * 0.1),
      ]);
      expect(res.failed_attempts).toBe(i);
      expect(res.locked_until).toBeNull();
    }
    const tenth = await call("public.note_pair_failure($1, $2)", [id, at(1)]);
    expect(tenth.failed_attempts).toBe(10);
    expect(Date.parse(tenth.locked_until as string)).toBe(
      Date.parse(at(1)) + 15 * 60_000,
    );
  });

  it("starts a new window once ten minutes have passed", async () => {
    const id = await newSchool();
    await call("public.note_pair_failure($1, $2)", [id, at(0)]);
    await call("public.note_pair_failure($1, $2)", [id, at(5)]);
    const roll = await call("public.note_pair_failure($1, $2)", [id, at(11)]);
    expect(roll.failed_attempts).toBe(1);
    const next = await call("public.note_pair_failure($1, $2)", [id, at(12)]);
    expect(next.failed_attempts).toBe(2);
  });

  it("never touches existing devices, even when it locks", async () => {
    const id = await newSchool();
    const device = await insertAuthUser(db, { anonymous: true });
    await call("public.pair_device($1, $2, true, false, null)", [id, device]);
    for (let i = 0; i < 10; i++) {
      await call("public.note_pair_failure($1, $2)", [id, at(i * 0.1)]);
    }
    expect(
      await rows("select 1 from public.school_devices where school_id = $1", [
        id,
      ]),
    ).toHaveLength(1);
  });
});

describe("set_school_code", () => {
  async function schoolWithDevices() {
    const id = await newSchool();
    const ann = await insertAuthUser(db, { anonymous: true });
    const disp = await insertAuthUser(db, { anonymous: true });
    const both = await insertAuthUser(db, { anonymous: true });
    await call("public.pair_device($1, $2, true, false, 'phone')", [id, ann]);
    await call("public.pair_device($1, $2, false, true, 'tv')", [id, disp]);
    await call("public.pair_device($1, $2, true, true, 'both')", [id, both]);
    return { id, ann, disp, both };
  }

  it("sets the announce code, bumps its version and clears the lockout", async () => {
    const id = await newSchool();
    for (let i = 0; i < 10; i++) {
      await call("public.note_pair_failure($1)", [id]);
    }
    const res = await call(
      "public.set_school_code($1, 'announce', 'ABC123', false)",
      [id],
    );
    expect(res).toMatchObject({
      announce_code: "ABC123",
      display_code: null,
      disconnected_user_ids: [],
    });
    const [s] = await rows<Json>(
      "select announce_code_version a, display_code_version d, failed_attempts f, failed_window_started_at w, locked_until l from public.school_secrets where school_id = $1",
      [id],
    );
    expect(s).toEqual({ a: 2, d: 1, f: 0, w: null, l: null });
  });

  it("sets both codes, and null clears one", async () => {
    const id = await newSchool();
    await call("public.set_school_code($1, 'both', 'SAME99', false)", [id]);
    const res = await call(
      "public.set_school_code($1, 'display', null, false)",
      [id],
    );
    expect(res).toMatchObject({ announce_code: "SAME99", display_code: null });
  });

  it("without disconnect leaves every device row", async () => {
    const { id } = await schoolWithDevices();
    const res = await call(
      "public.set_school_code($1, 'both', 'NEWCODE1', false)",
      [id],
    );
    expect(res.disconnected_user_ids).toEqual([]);
    expect(
      await rows("select 1 from public.school_devices where school_id = $1", [
        id,
      ]),
    ).toHaveLength(3);
  });

  it("disconnecting announce removes announce-capable devices only", async () => {
    const { id, ann, disp, both } = await schoolWithDevices();
    const res = await call(
      "public.set_school_code($1, 'announce', 'NEWCODE1', true)",
      [id],
    );
    expect((res.disconnected_user_ids as string[]).sort()).toEqual(
      [ann, both].sort(),
    );
    const left = await rows<{ user_id: string }>(
      "select user_id from public.school_devices where school_id = $1",
      [id],
    );
    expect(left).toEqual([{ user_id: disp }]);
  });

  it("disconnecting display removes display-capable devices only", async () => {
    const { id, ann, disp, both } = await schoolWithDevices();
    const res = await call(
      "public.set_school_code($1, 'display', 'NEWCODE2', true)",
      [id],
    );
    expect((res.disconnected_user_ids as string[]).sort()).toEqual(
      [disp, both].sort(),
    );
    const left = await rows<{ user_id: string }>(
      "select user_id from public.school_devices where school_id = $1",
      [id],
    );
    expect(left).toEqual([{ user_id: ann }]);
  });

  it("disconnecting both removes every device, and never another school's", async () => {
    const { id } = await schoolWithDevices();
    const other = await newSchool();
    const keeper = await insertAuthUser(db, { anonymous: true });
    await call("public.pair_device($1, $2, true, true, null)", [other, keeper]);

    const res = await call(
      "public.set_school_code($1, 'both', 'NEWCODE3', true)",
      [id],
    );
    expect(res.disconnected_user_ids as string[]).toHaveLength(3);
    expect(
      await rows("select 1 from public.school_devices where school_id = $1", [
        id,
      ]),
    ).toHaveLength(0);
    expect(
      await rows("select 1 from public.school_devices where school_id = $1", [
        other,
      ]),
    ).toHaveLength(1);
  });

  it("rejects an unknown capability", async () => {
    const id = await newSchool();
    await expect(
      call("public.set_school_code($1, 'nonsense', 'ABC123', false)", [id]),
    ).rejects.toThrow();
  });
});

describe("pair_device", () => {
  it("records the code versions it paired with and when it was seen", async () => {
    const id = await newSchool();
    await call("public.set_school_code($1, 'announce', 'ABC123', false)", [id]);
    const user = await insertAuthUser(db, { anonymous: true });
    const row = await call(
      "public.pair_device($1, $2, true, false, 'Front door')",
      [id, user],
    );
    expect(row).toMatchObject({
      school_id: id,
      user_id: user,
      can_announce: true,
      can_display: false,
      announce_code_version: 2,
      display_code_version: null,
      label: "Front door",
    });
    expect(row.last_seen_at).not.toBeNull();
  });

  it("merges capabilities when the same device pairs twice in one school", async () => {
    const id = await newSchool();
    const user = await insertAuthUser(db, { anonymous: true });
    await call("public.pair_device($1, $2, true, false, null)", [id, user]);
    const row = await call("public.pair_device($1, $2, false, true, null)", [
      id,
      user,
    ]);
    expect(row).toMatchObject({ can_announce: true, can_display: true });
    expect(
      await rows("select 1 from public.school_devices where user_id = $1", [
        user,
      ]),
    ).toHaveLength(1);
  });

  it("moves a device to another school and replaces its capabilities", async () => {
    const a = await newSchool();
    const b = await newSchool();
    const user = await insertAuthUser(db, { anonymous: true });
    await call("public.pair_device($1, $2, true, true, null)", [a, user]);
    const row = await call("public.pair_device($1, $2, false, true, null)", [
      b,
      user,
    ]);
    expect(row).toMatchObject({
      school_id: b,
      can_announce: false,
      can_display: true,
      announce_code_version: null,
    });
    expect(
      await rows("select 1 from public.school_devices where school_id = $1", [
        a,
      ]),
    ).toHaveLength(0);
  });
});

describe("access", () => {
  const calls = [
    "public.create_school(gen_random_uuid(), 'X', 'x-slug-1', 'UTC')",
    "public.note_pair_failure(gen_random_uuid())",
    "public.set_school_code(gen_random_uuid(), 'both', 'ABC123', false)",
    "public.pair_device(gen_random_uuid(), gen_random_uuid(), true, true, null)",
  ];

  it.each(["anon", "authenticated"])("is not callable as %s", async (role) => {
    for (const sql of calls) {
      await asRoleOn(db, role, async () => {
        await expect(call(sql)).rejects.toThrow(/permission denied/i);
      });
    }
  });

  it("is callable as service_role", async () => {
    await asRoleOn(db, "service_role", async () => {
      const res = await call("public.note_pair_failure(gen_random_uuid())");
      // Unknown school: the update matches nothing, so nothing is counted.
      expect(res).toBeDefined();
    });
  });
});
