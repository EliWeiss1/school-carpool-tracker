import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BOOTSTRAP, asRoleOn, insertAuthUser } from "./test-bootstrap";

/**
 * The school functions the pair-device and school-write Edge Functions call,
 * tested by running them: school creation, code changes with optional
 * disconnect, and the single-transaction pairing decision.
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

/** A device row with exactly these capabilities, bypassing the code check. */
async function seedDevice(
  schoolId: string,
  userId: string,
  announce: boolean,
  display: boolean,
  label: string | null,
): Promise<void> {
  await db.query(
    "insert into public.school_devices (school_id, user_id, can_announce, can_display, label) values ($1, $2, $3, $4, $5)",
    [schoolId, userId, announce, display, label],
  );
}

const T0 = Date.parse("2026-11-13T12:00:00Z");
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

async function slugOf(schoolId: string): Promise<string> {
  const res = await rows<{ slug: string }>(
    "select slug from public.schools where id = $1",
    [schoolId],
  );
  return res[0].slug;
}

interface AttemptOptions {
  ip?: string;
  label?: string | null;
  now?: string;
}

async function attempt(
  schoolId: string,
  code: string | null,
  userId: string,
  options: AttemptOptions = {},
): Promise<Json> {
  return await call("public.attempt_pairing($1, $2, $3, $4, $5, $6)", [
    await slugOf(schoolId),
    code,
    userId,
    options.label ?? null,
    options.ip ?? "1.1.1.1",
    options.now ?? at(0),
  ]);
}

async function schoolWithCodes(): Promise<string> {
  const id = await newSchool();
  await call("public.set_school_code($1, 'announce', 'ANN111', false)", [id]);
  await call("public.set_school_code($1, 'display', 'DISP22', false)", [id]);
  return id;
}

async function wrongCodes(
  schoolId: string,
  n: number,
  ip: string,
  minutes = 0,
): Promise<void> {
  for (let i = 0; i < n; i++) {
    const user = await insertAuthUser(db, { anonymous: true });
    await attempt(schoolId, "WRONG0", user, { ip, now: at(minutes) });
  }
}

async function ipRow(schoolId: string, ip: string) {
  const res = await rows<{ attempts: number; locked_until: string | null }>(
    "select attempts, locked_until from public.school_pair_attempts where school_id = $1 and client_ip = $2",
    [schoolId, ip],
  );
  return res[0];
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
    expect(results.map((r) => r.status).sort()).toEqual([
      "created",
      "slug-taken",
    ]);
  });
});

describe("set_school_code", () => {
  async function schoolWithDevices() {
    const id = await newSchool();
    const ann = await insertAuthUser(db, { anonymous: true });
    const disp = await insertAuthUser(db, { anonymous: true });
    const both = await insertAuthUser(db, { anonymous: true });
    await seedDevice(id, ann, true, false, "phone");
    await seedDevice(id, disp, false, true, "tv");
    await seedDevice(id, both, true, true, "both");
    return { id, ann, disp, both };
  }

  it("sets the announce code, bumps its version and clears every lockout and attempt row", async () => {
    const id = await newSchool();
    await call("public.set_school_code($1, 'announce', 'REAL123', false)", [
      id,
    ]);
    await wrongCodes(id, 10, "9.9.9.9");
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
    expect(s).toEqual({ a: 3, d: 1, f: 0, w: null, l: null });
    expect(
      await rows(
        "select 1 from public.school_pair_attempts where school_id = $1",
        [id],
      ),
    ).toHaveLength(0);
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
    await seedDevice(other, keeper, true, true, null);

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

describe("attempt_pairing", () => {
  it("refuses an unknown slug", async () => {
    const user = await insertAuthUser(db, { anonymous: true });
    const res = await call(
      "public.attempt_pairing('nope-nope', 'X', $1, null, '1.1.1.1', $2)",
      [user, at(0)],
    );
    expect(res).toEqual({ status: "refused" });
  });

  it("pairs with the announce code and records versions, label and time", async () => {
    const id = await schoolWithCodes();
    const user = await insertAuthUser(db, { anonymous: true });
    const res = await attempt(id, "ANN111", user, { label: "Front door" });
    expect(res).toMatchObject({
      status: "paired",
      can_announce: true,
      can_display: false,
    });
    const [row] = await rows<Json>(
      "select can_announce, can_display, announce_code_version a, display_code_version d, label, last_seen_at from public.school_devices where user_id = $1",
      [user],
    );
    expect(row).toMatchObject({
      can_announce: true,
      can_display: false,
      a: 2,
      d: null,
      label: "Front door",
    });
    expect(row.last_seen_at).not.toBeNull();
  });

  it("grants both when the two codes are equal", async () => {
    const id = await newSchool();
    await call("public.set_school_code($1, 'both', 'SAME99', false)", [id]);
    const user = await insertAuthUser(db, { anonymous: true });
    expect(await attempt(id, "SAME99", user)).toMatchObject({
      can_announce: true,
      can_display: true,
    });
  });

  it("compares codes exactly (no case folding in the database)", async () => {
    const id = await schoolWithCodes();
    const user = await insertAuthUser(db, { anonymous: true });
    expect((await attempt(id, "ann111", user)).status).toBe("refused");
  });

  it("never matches a null stored code, even an empty guess", async () => {
    const id = await newSchool();
    const user = await insertAuthUser(db, { anonymous: true });
    expect((await attempt(id, "", user)).status).toBe("refused");
    expect((await attempt(id, null, user)).status).toBe("refused");
    expect(
      await rows("select 1 from public.school_devices where school_id = $1", [
        id,
      ]),
    ).toHaveLength(0);
  });

  it("merges capabilities when one device pairs twice in a school, keeping the label", async () => {
    const id = await schoolWithCodes();
    const user = await insertAuthUser(db, { anonymous: true });
    await attempt(id, "ANN111", user, { label: "Hall" });
    const res = await attempt(id, "DISP22", user);
    expect(res).toMatchObject({ can_announce: false, can_display: true });
    const [row] = await rows<Json>(
      "select can_announce, can_display, label from public.school_devices where user_id = $1",
      [user],
    );
    expect(row).toEqual({
      can_announce: true,
      can_display: true,
      label: "Hall",
    });
  });

  it("moves a device to another school and replaces everything", async () => {
    const a = await schoolWithCodes();
    const b = await schoolWithCodes();
    const user = await insertAuthUser(db, { anonymous: true });
    await attempt(a, "ANN111", user, { label: "Old" });
    await attempt(a, "DISP22", user);
    await attempt(b, "DISP22", user);
    const devices = await rows<Json>(
      "select school_id, can_announce, can_display, announce_code_version a, label from public.school_devices where user_id = $1",
      [user],
    );
    expect(devices).toEqual([
      {
        school_id: b,
        can_announce: false,
        can_display: true,
        a: null,
        label: null,
      },
    ]);
  });

  it("does not count a success against either limit", async () => {
    const id = await schoolWithCodes();
    for (let i = 0; i < 30; i++) {
      const user = await insertAuthUser(db, { anonymous: true });
      expect((await attempt(id, "ANN111", user)).status).toBe("paired");
    }
    expect((await ipRow(id, "1.1.1.1")).attempts).toBe(0);
    const [s] = await rows<Json>(
      "select failed_attempts f from public.school_secrets where school_id = $1",
      [id],
    );
    expect(s.f).toBe(0);
  });

  it("locks an address at its tenth wrong code, with a 15 minute lock", async () => {
    const id = await schoolWithCodes();
    await wrongCodes(id, 9, "5.5.5.5");
    expect((await ipRow(id, "5.5.5.5")).locked_until).toBeNull();
    await wrongCodes(id, 1, "5.5.5.5");
    const user = await insertAuthUser(db, { anonymous: true });
    const res = await attempt(id, "ANN111", user, {
      ip: "5.5.5.5",
      now: at(1),
    });
    expect(res.status).toBe("locked");
    expect(Date.parse(res.locked_until as string)).toBe(
      Date.parse(at(0)) + 15 * 60_000,
    );
  });

  it("does not compare, or count, while an address is locked", async () => {
    const id = await schoolWithCodes();
    await wrongCodes(id, 10, "5.5.5.5");
    await wrongCodes(id, 3, "5.5.5.5", 1);
    expect((await ipRow(id, "5.5.5.5")).attempts).toBe(10);
  });

  it("a locked address does not stop another address pairing", async () => {
    const id = await schoolWithCodes();
    await wrongCodes(id, 10, "5.5.5.5");
    const user = await insertAuthUser(db, { anonymous: true });
    expect(
      (await attempt(id, "ANN111", user, { ip: "6.6.6.6", now: at(1) })).status,
    ).toBe("paired");
  });

  it("pairs again once the address lock has expired", async () => {
    const id = await schoolWithCodes();
    await wrongCodes(id, 10, "5.5.5.5");
    const user = await insertAuthUser(db, { anonymous: true });
    const res = await attempt(id, "ANN111", user, {
      ip: "5.5.5.5",
      now: at(15.1),
    });
    expect(res.status).toBe("paired");
  });

  it("starts a new counting window after ten minutes", async () => {
    const id = await schoolWithCodes();
    await wrongCodes(id, 9, "5.5.5.5", 0);
    await wrongCodes(id, 1, "5.5.5.5", 11);
    expect((await ipRow(id, "5.5.5.5")).attempts).toBe(1);
    expect((await ipRow(id, "5.5.5.5")).locked_until).toBeNull();
  });

  it("keeps an unexpired lock even when the counting window has rolled over", async () => {
    const id = await schoolWithCodes();
    await wrongCodes(id, 10, "5.5.5.5", 9);
    const user = await insertAuthUser(db, { anonymous: true });
    // The lock runs to minute 24; the 10 minute window rolled at minute 19.
    const res = await attempt(id, "ANN111", user, {
      ip: "5.5.5.5",
      now: at(21),
    });
    expect(res.status).toBe("locked");
  });

  it("locks the whole school at 100 wrong codes in an hour, across addresses", async () => {
    const id = await schoolWithCodes();
    for (let i = 0; i < 99; i++) {
      await wrongCodes(id, 1, `10.0.0.${i}`, i / 10);
    }
    const ok = await insertAuthUser(db, { anonymous: true });
    expect(
      (await attempt(id, "ANN111", ok, { ip: "10.1.0.1", now: at(11) })).status,
    ).toBe("paired");
    await wrongCodes(id, 1, "10.0.9.9", 12);
    const user = await insertAuthUser(db, { anonymous: true });
    const res = await attempt(id, "ANN111", user, {
      ip: "10.2.0.2",
      now: at(13),
    });
    expect(res.status).toBe("locked");
    expect(Date.parse(res.locked_until as string)).toBe(
      Date.parse(at(12)) + 15 * 60_000,
    );
    // ...and it lifts after 15 minutes.
    expect(
      (await attempt(id, "ANN111", user, { ip: "10.2.0.2", now: at(28) }))
        .status,
    ).toBe("paired");
  });

  it("restarts the school's hour window after an hour", async () => {
    const id = await schoolWithCodes();
    for (let i = 0; i < 99; i++) await wrongCodes(id, 1, `10.0.0.${i}`, 0);
    await wrongCodes(id, 1, "10.0.9.9", 61);
    const user = await insertAuthUser(db, { anonymous: true });
    expect(
      (await attempt(id, "ANN111", user, { ip: "10.2.0.2", now: at(62) }))
        .status,
    ).toBe("paired");
  });

  it("a school's lock does not affect another school", async () => {
    const a = await schoolWithCodes();
    const b = await schoolWithCodes();
    await wrongCodes(a, 10, "5.5.5.5");
    const user = await insertAuthUser(db, { anonymous: true });
    expect(
      (await attempt(b, "ANN111", user, { ip: "5.5.5.5", now: at(1) })).status,
    ).toBe("paired");
  });

  it("a lockout leaves connected devices alone", async () => {
    const id = await schoolWithCodes();
    const device = await insertAuthUser(db, { anonymous: true });
    await attempt(id, "ANN111", device);
    await wrongCodes(id, 10, "5.5.5.5");
    expect(
      await rows("select 1 from public.school_devices where school_id = $1", [
        id,
      ]),
    ).toHaveLength(1);
  });

  it("deletes this school's attempt rows older than a day", async () => {
    const id = await schoolWithCodes();
    await wrongCodes(id, 1, "7.7.7.7", 0);
    const user = await insertAuthUser(db, { anonymous: true });
    await attempt(id, "ANN111", user, { ip: "8.8.8.8", now: at(60 * 25) });
    expect(await ipRow(id, "7.7.7.7")).toBeUndefined();
  });

  it("changing the code clears every lock", async () => {
    const id = await schoolWithCodes();
    await wrongCodes(id, 10, "5.5.5.5");
    await call("public.set_school_code($1, 'announce', 'FRESH11', false)", [
      id,
    ]);
    const user = await insertAuthUser(db, { anonymous: true });
    expect(
      (await attempt(id, "FRESH11", user, { ip: "5.5.5.5", now: at(1) }))
        .status,
    ).toBe("paired");
  });
});

describe("access", () => {
  const calls = [
    "public.create_school(gen_random_uuid(), 'X', 'x-slug-1', 'UTC')",
    "public.set_school_code(gen_random_uuid(), 'both', 'ABC123', false)",
    "public.attempt_pairing('x', 'ABC123', gen_random_uuid(), null, '1.1.1.1')",
  ];

  it.each(["anon", "authenticated"])("is not callable as %s", async (role) => {
    for (const sql of calls) {
      await asRoleOn(db, role, async () => {
        await expect(call(sql)).rejects.toThrow(/permission denied/i);
      });
    }
  });

  it.each(["anon", "authenticated"])(
    "leaves the attempts table unreadable as %s",
    async (role) => {
      await asRoleOn(db, role, async () => {
        await expect(
          rows("select * from public.school_pair_attempts"),
        ).rejects.toThrow(/permission denied/i);
      });
    },
  );

  it("is callable as service_role", async () => {
    await asRoleOn(db, "service_role", async () => {
      expect(
        await call(
          "public.attempt_pairing('unknown-slug', 'X', gen_random_uuid(), null, '1.1.1.1')",
        ),
      ).toEqual({ status: "refused" });
    });
  });
});
