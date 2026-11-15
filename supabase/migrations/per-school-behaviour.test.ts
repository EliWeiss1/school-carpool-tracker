import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BOOTSTRAP, asRoleOn, insertAuthUser } from "./test-bootstrap";

/**
 * Per-school behaviour (20261114120000): the board reset that follows each
 * school's own clock, the monthly voice-session cap, and the stale
 * anonymous-user sweep. Tested by running the functions in PGlite.
 *
 * What PGlite cannot show: pg_cron itself (not in PGlite, so the schedule
 * blocks are skipped here), real concurrency (one connection, so overlapping
 * calls are never actually parallel), and Postgres 17 (PGlite is 18).
 */

const DIR = dirname(fileURLToPath(import.meta.url));
const SCHOOL_1 = "00000000-0000-4000-8000-000000000001";

async function freshDb(): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec(BOOTSTRAP);
  for (const file of readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(join(DIR, file), "utf8"));
  }
  return db;
}

interface Json {
  [key: string]: unknown;
}

let db: PGlite;

async function call(sql: string, params: unknown[] = []): Promise<Json> {
  const res = await db.query<{ r: Json }>(`select ${sql} as r`, params);
  return res.rows[0].r;
}

async function scalar<T>(sql: string, params: unknown[] = []): Promise<T> {
  const res = await db.query<{ v: T }>(`select ${sql} as v`, params);
  return res.rows[0].v;
}

let counter = 0;

interface SchoolOpts {
  timezone?: string;
  resetHour?: number;
  resetDays?: number[];
  voiceEnabled?: boolean;
  voiceLimit?: number | null;
}

async function newSchool(opts: SchoolOpts = {}): Promise<string> {
  const res = await db.query<{ id: string }>(
    `insert into public.schools
       (name, slug, timezone, reset_hour, reset_days, voice_enabled, voice_monthly_limit)
     values ($1, $2, $3, $4, $5::smallint[], $6, $7) returning id`,
    [
      "Test",
      `per-school-${++counter}`,
      opts.timezone ?? "UTC",
      opts.resetHour ?? 20,
      `{${(opts.resetDays ?? [0, 1, 2, 3, 4, 5, 6]).join(",")}}`,
      opts.voiceEnabled ?? true,
      opts.voiceLimit === undefined ? 5 : opts.voiceLimit,
    ],
  );
  return res.rows[0].id;
}

async function addStudent(
  schoolId: string,
  status: "waiting" | "arrived",
): Promise<string> {
  const res = await db.query<{ id: string }>(
    "insert into public.students (school_id, first_name, last_name, status) values ($1, 'A', $2, $3) returning id",
    [schoolId, `S${++counter}`, status],
  );
  return res.rows[0].id;
}

async function statusOf(studentId: string): Promise<string> {
  return scalar<string>("(select status from public.students where id = $1)", [
    studentId,
  ]);
}

async function auditCount(schoolId: string): Promise<number> {
  return Number(
    await scalar<string>(
      "(select count(*) from public.status_events where school_id = $1)",
      [schoolId],
    ),
  );
}

async function lastResetOn(schoolId: string): Promise<string | null> {
  return scalar<string | null>(
    "(select last_reset_on::text from public.schools where id = $1)",
    [schoolId],
  );
}

beforeAll(async () => {
  db = await freshDb();
  // School 1 stays out of the way: these tests drive other schools.
  await db.query("update public.schools set reset_days = '{}' where id = $1", [
    SCHOOL_1,
  ]);
});

afterAll(async () => {
  await db.close();
});

describe("reset_school_board", () => {
  it("resets only that school's arrived students and audits each", async () => {
    const a = await newSchool();
    const b = await newSchool();
    const arrived = await addStudent(a, "arrived");
    const waiting = await addStudent(a, "waiting");
    const other = await addStudent(b, "arrived");

    const moved = await scalar<number>("public.reset_school_board($1)", [a]);

    expect(moved).toBe(1);
    expect(await statusOf(arrived)).toBe("waiting");
    expect(await statusOf(waiting)).toBe("waiting");
    expect(await statusOf(other)).toBe("arrived");
    // One admin audit row, for the moved student only, in the right school.
    expect(await auditCount(a)).toBe(1);
    expect(await auditCount(b)).toBe(0);
    const rows = (
      await db.query<{
        student_id: string;
        changed_to: string;
        source: string;
      }>(
        "select student_id, changed_to, source from public.status_events where school_id = $1",
        [a],
      )
    ).rows;
    expect(rows).toEqual([
      { student_id: arrived, changed_to: "waiting", source: "admin" },
    ]);
  });

  it("returns 0 and writes nothing for an already-waiting board", async () => {
    const a = await newSchool();
    await addStudent(a, "waiting");
    expect(await scalar<number>("public.reset_school_board($1)", [a])).toBe(0);
    expect(await auditCount(a)).toBe(0);
  });
});

describe("run_due_board_resets", () => {
  it("resets a school at its own local time, not another's", async () => {
    // 2026-11-15 is a Sunday. Jerusalem is UTC+2 in November: 21:00 local
    // is 19:00 UTC.
    const jlm = await newSchool({
      timezone: "Asia/Jerusalem",
      resetHour: 21,
      resetDays: [0],
    });
    const la = await newSchool({
      timezone: "America/Los_Angeles",
      resetHour: 20,
      resetDays: [0, 1, 2, 3, 4, 5, 6],
    });
    const jlmKid = await addStudent(jlm, "arrived");
    const laKid = await addStudent(la, "arrived");

    // 19:00 UTC Sunday: 21:00 in Jerusalem, 11:00 in Los Angeles.
    const first = await call("public.run_due_board_resets($1)", [
      "2026-11-15T19:00:00Z",
    ]);
    expect(await statusOf(jlmKid)).toBe("waiting");
    expect(await statusOf(laKid)).toBe("arrived");
    expect(first.schools_reset).toBeGreaterThanOrEqual(1);

    // 04:00 UTC Monday: 20:00 Sunday in Los Angeles.
    await call("public.run_due_board_resets($1)", ["2026-11-16T04:00:00Z"]);
    expect(await statusOf(laKid)).toBe("waiting");
  });

  it("reports how many schools and students it reset", async () => {
    const s = await newSchool({ resetHour: 6, resetDays: [3] });
    await addStudent(s, "arrived");
    await addStudent(s, "arrived");
    // 2026-11-18 is a Wednesday. Other schools from earlier tests are not due
    // at 06:00 UTC on a Wednesday (their hours are 20 and 21).
    const result = await call("public.run_due_board_resets($1)", [
      "2026-11-18T06:30:00Z",
    ]);
    expect(result).toEqual({ schools_reset: 1, students_reset: 2 });
  });

  it("resets once when run twice in the same hour", async () => {
    const s = await newSchool({ resetHour: 7, resetDays: [3] });
    const kid = await addStudent(s, "arrived");
    await call("public.run_due_board_resets($1)", ["2026-11-18T07:00:00Z"]);
    expect(await statusOf(kid)).toBe("waiting");
    const audit = await auditCount(s);

    // The student arrives again, then the cron fires a second time in the
    // same local hour: it must leave them alone.
    await db.query(
      "update public.students set status = 'arrived' where id = $1",
      [kid],
    );
    const second = await call("public.run_due_board_resets($1)", [
      "2026-11-18T07:00:00Z",
    ]);
    expect(second).toEqual({ schools_reset: 0, students_reset: 0 });
    expect(await statusOf(kid)).toBe("arrived");
    expect(await auditCount(s)).toBe(audit);
  });

  it("resets again the next day", async () => {
    const s = await newSchool({ resetHour: 8 });
    const kid = await addStudent(s, "arrived");
    await call("public.run_due_board_resets($1)", ["2026-11-18T08:00:00Z"]);
    await db.query(
      "update public.students set status = 'arrived' where id = $1",
      [kid],
    );
    await call("public.run_due_board_resets($1)", ["2026-11-19T08:00:00Z"]);
    expect(await statusOf(kid)).toBe("waiting");
    expect(await lastResetOn(s)).toBe("2026-11-19");
  });

  it("never resets a school with no reset days", async () => {
    const s = await newSchool({ resetHour: 9, resetDays: [] });
    const kid = await addStudent(s, "arrived");
    await call("public.run_due_board_resets($1)", ["2026-11-18T09:00:00Z"]);
    expect(await statusOf(kid)).toBe("arrived");
    expect(await lastResetOn(s)).toBeNull();
  });

  it("records last_reset_on even when nothing was arrived", async () => {
    const s = await newSchool({ resetHour: 10 });
    await addStudent(s, "waiting");
    await call("public.run_due_board_resets($1)", ["2026-11-18T10:00:00Z"]);
    expect(await lastResetOn(s)).toBe("2026-11-18");
    expect(await auditCount(s)).toBe(0);
  });

  it("judges the weekday and date in the school's zone", async () => {
    // 2026-11-18T23:00Z is already Thursday 01:00 in Jerusalem.
    const s = await newSchool({
      timezone: "Asia/Jerusalem",
      resetHour: 1,
      resetDays: [4],
    });
    const kid = await addStudent(s, "arrived");
    await call("public.run_due_board_resets($1)", ["2026-11-18T23:00:00Z"]);
    expect(await statusOf(kid)).toBe("waiting");
    expect(await lastResetOn(s)).toBe("2026-11-19");
  });

  it("skips a school with an invalid time zone and still resets the rest", async () => {
    const bad = await newSchool({ resetHour: 11 });
    // Break it after insert, the way a bad value could arrive on a live row.
    await db.query(
      "update public.schools set timezone = 'Mars/Olympus' where id = $1",
      [bad],
    );
    const good = await newSchool({ resetHour: 11 });
    const badKid = await addStudent(bad, "arrived");
    const goodKid = await addStudent(good, "arrived");

    await call("public.run_due_board_resets($1)", ["2026-11-18T11:00:00Z"]);

    expect(await statusOf(goodKid)).toBe("waiting");
    expect(await statusOf(badKid)).toBe("arrived");
    expect(await lastResetOn(bad)).toBeNull();
  });

  it("is not callable by anon or authenticated", async () => {
    for (const role of ["anon", "authenticated"]) {
      await expect(
        asRoleOn(db, role, () =>
          db.query("select public.run_due_board_resets()"),
        ),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        asRoleOn(db, role, () =>
          db.query("select public.reset_school_board($1)", [SCHOOL_1]),
        ),
      ).rejects.toThrow(/permission denied/i);
    }
    await asRoleOn(db, "service_role", () =>
      db.query("select public.run_due_board_resets('2000-01-01T00:00:00Z')"),
    );
  });
});

describe("year-long replay against the legacy nightly job", () => {
  it("fires school #1 on exactly the same hours as nightly_reset_board()", async () => {
    // A fresh database holding only school #1, as configured by the expand
    // migration (8 PM Pacific, Sunday to Thursday).
    const replay = await freshDb();
    try {
      const start = Date.parse("2026-01-01T00:00:00Z");
      const end = Date.parse("2027-01-01T00:00:00Z");
      const oldFired: string[] = [];
      const newFired: string[] = [];

      for (let t = start; t < end; t += 3_600_000) {
        const at = new Date(t).toISOString();
        // nightly_reset_board takes the time as an argument, so it is driven
        // directly: a non-null result means it decided "now is the time".
        const old = await replay.query<{ v: number | null }>(
          "select public.nightly_reset_board($1) as v",
          [at],
        );
        if (old.rows[0].v !== null) oldFired.push(at);

        const next = await replay.query<{ v: { schools_reset: number } }>(
          "select public.run_due_board_resets($1) as v",
          [at],
        );
        if (next.rows[0].v.schools_reset === 1) newFired.push(at);
      }

      expect(newFired).toEqual(oldFired);

      // Not vacuous: roughly five nights in seven, and across both clock
      // changes the firing moves between 03:00 and 04:00 UTC.
      expect(oldFired.length).toBeGreaterThan(250);
      expect(oldFired.length).toBeLessThan(270);
      const utcHours = new Set(oldFired.map((s) => new Date(s).getUTCHours()));
      expect([...utcHours].sort()).toEqual([3, 4]);
    } finally {
      await replay.close();
    }
  }, 180_000);
});

describe("claim_voice_session", () => {
  const NOW = "2026-11-14T12:00:00Z";
  const claim = (id: string, now = NOW) =>
    call("public.claim_voice_session($1, $2)", [id, now]);
  const usedIn = async (id: string, month: string) =>
    scalar<number | null>(
      "(select voice_sessions from public.school_usage where school_id = $1 and month = $2)",
      [id, month],
    );

  it("allows claims below the limit and counts them", async () => {
    const s = await newSchool({ voiceLimit: 3 });
    expect(await claim(s)).toEqual({ allowed: true, used: 1, limit: 3 });
    expect(await claim(s)).toEqual({ allowed: true, used: 2, limit: 3 });
  });

  it("refuses exactly at the limit and leaves the counter alone", async () => {
    const s = await newSchool({ voiceLimit: 2 });
    await claim(s);
    await claim(s);
    expect(await claim(s)).toEqual({
      allowed: false,
      reason: "limit",
      used: 2,
      limit: 2,
    });
    expect(await claim(s)).toMatchObject({ allowed: false, reason: "limit" });
    expect(await usedIn(s, "2026-11-01")).toBe(2);
  });

  it("refuses a zero limit without ever counting", async () => {
    const s = await newSchool({ voiceLimit: 0 });
    expect(await claim(s)).toEqual({
      allowed: false,
      reason: "limit",
      used: 0,
      limit: 0,
    });
    expect(await usedIn(s, "2026-11-01")).toBeNull();
  });

  it("never refuses a school with no limit", async () => {
    const s = await newSchool({ voiceLimit: null });
    for (let i = 1; i <= 20; i++) {
      expect(await claim(s)).toEqual({ allowed: true, used: i, limit: null });
    }
  });

  it("starts a fresh count each month (UTC)", async () => {
    const s = await newSchool({ voiceLimit: 1 });
    await claim(s, "2026-11-30T23:59:59Z");
    expect(await claim(s, "2026-11-30T23:59:59Z")).toMatchObject({
      allowed: false,
    });
    expect(await claim(s, "2026-12-01T00:00:00Z")).toEqual({
      allowed: true,
      used: 1,
      limit: 1,
    });
    expect(await usedIn(s, "2026-11-01")).toBe(1);
    expect(await usedIn(s, "2026-12-01")).toBe(1);
  });

  it("refuses a school with voice turned off", async () => {
    const s = await newSchool({ voiceEnabled: false });
    expect(await claim(s)).toEqual({ allowed: false, reason: "disabled" });
    expect(await usedIn(s, "2026-11-01")).toBeNull();
  });

  it("treats an unknown school as disabled", async () => {
    expect(await claim("99999999-9999-4999-8999-999999999999")).toEqual({
      allowed: false,
      reason: "disabled",
    });
  });

  it("counts two schools separately", async () => {
    const a = await newSchool({ voiceLimit: 1 });
    const b = await newSchool({ voiceLimit: 1 });
    expect(await claim(a)).toMatchObject({ allowed: true });
    expect(await claim(b)).toMatchObject({ allowed: true });
    expect(await claim(a)).toMatchObject({ allowed: false });
  });

  it("checks and increments in one statement (the parallel-safety design)", async () => {
    // The guarantee against two parallel claims both squeezing under the cap
    // is structural: the limit check is the `where` of the same
    // insert ... on conflict do update that increments, so Postgres re-checks
    // it under the row lock. PGlite has one connection, so truly concurrent
    // claims are NOT exercised here; this pins the structure that makes them
    // safe, so a refactor into select-then-update cannot slip through.
    const sql = readFileSync(
      join(DIR, "20261114120000_per_school_behaviour.sql"),
      "utf8",
    );
    const body = /function public\.claim_voice_session[\s\S]*?\$\$;/.exec(
      sql,
    )?.[0];
    expect(body).toBeDefined();
    expect(body).toMatch(/on conflict \(school_id, month\) do update/i);
    expect(body).toMatch(/where[\s\S]*voice_sessions\s*<\s*v_limit/i);
  });

  it("is service_role only", async () => {
    const s = await newSchool();
    for (const role of ["anon", "authenticated"]) {
      await expect(
        asRoleOn(db, role, () =>
          db.query("select public.claim_voice_session($1)", [s]),
        ),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        asRoleOn(db, role, () =>
          db.query("select public.school_voice_usage($1)", [s]),
        ),
      ).rejects.toThrow(/permission denied/i);
    }
  });
});

describe("school_voice_usage", () => {
  it("reports this month's usage, limit and enabled flag", async () => {
    const s = await newSchool({ voiceLimit: 4 });
    const now = "2026-11-14T12:00:00Z";
    await call("public.claim_voice_session($1, $2)", [s, now]);
    await call("public.claim_voice_session($1, $2)", [s, now]);
    expect(await call("public.school_voice_usage($1, $2)", [s, now])).toEqual({
      used: 2,
      limit: 4,
      enabled: true,
    });
    // A different month has its own (empty) count.
    expect(
      await call("public.school_voice_usage($1, $2)", [
        s,
        "2026-12-02T00:00:00Z",
      ]),
    ).toEqual({ used: 0, limit: 4, enabled: true });
  });

  it("reports a school with voice off and no limit", async () => {
    const s = await newSchool({ voiceEnabled: false, voiceLimit: null });
    expect(
      await call("public.school_voice_usage($1, $2)", [
        s,
        "2026-11-14T00:00:00Z",
      ]),
    ).toEqual({ used: 0, limit: null, enabled: false });
  });
});

describe("delete_stale_anonymous_users", () => {
  async function userExists(id: string): Promise<boolean> {
    return (
      Number(
        await scalar<string>(
          "(select count(*) from auth.users where id = $1)",
          [id],
        ),
      ) === 1
    );
  }

  async function ageUser(id: string, days: number): Promise<void> {
    await db.query(
      "update auth.users set created_at = now() - make_interval(days => $2) where id = $1",
      [id, days],
    );
  }

  it("deletes old unpaired anonymous users and nothing else", async () => {
    const school = await newSchool();
    const staleAnon = await insertAuthUser(db, { anonymous: true });
    const freshAnon = await insertAuthUser(db, { anonymous: true });
    const pairedAnon = await insertAuthUser(db, { anonymous: true });
    const oldHuman = await insertAuthUser(db, { email: "old@x.test" });
    for (const id of [staleAnon, pairedAnon, oldHuman]) await ageUser(id, 3);
    await db.query(
      "insert into public.school_devices (school_id, user_id, can_announce) values ($1, $2, true)",
      [school, pairedAnon],
    );

    const deleted = await scalar<number>(
      "public.delete_stale_anonymous_users()",
    );

    expect(deleted).toBe(1);
    expect(await userExists(staleAnon)).toBe(false);
    expect(await userExists(freshAnon)).toBe(true);
    expect(await userExists(pairedAnon)).toBe(true);
    expect(await userExists(oldHuman)).toBe(true);
  });

  it("honours the interval argument", async () => {
    const u = await insertAuthUser(db, { anonymous: true });
    await ageUser(u, 2);
    expect(
      await scalar<number>(
        "public.delete_stale_anonymous_users(interval '7 days')",
      ),
    ).toBe(0);
    expect(await userExists(u)).toBe(true);
    expect(
      await scalar<number>(
        "public.delete_stale_anonymous_users(interval '1 day')",
      ),
    ).toBe(1);
  });

  it("is service_role only", async () => {
    for (const role of ["anon", "authenticated"]) {
      await expect(
        asRoleOn(db, role, () =>
          db.query("select public.delete_stale_anonymous_users()"),
        ),
      ).rejects.toThrow(/permission denied/i);
    }
  });
});

describe("rollout snippet", () => {
  it("is not a migration file", () => {
    const sqlFiles = readdirSync(DIR).filter((f) => f.endsWith(".sql"));
    expect(sqlFiles.some((f) => /unschedule/.test(f))).toBe(false);
    const snippet = readFileSync(
      join(DIR, "_rollout", "unschedule_legacy_nightly_reset.sql.txt"),
      "utf8",
    );
    expect(snippet).toMatch(/cron\.unschedule\('nightly-board-reset'\)/);
  });

  it("leaves the legacy job alone in the migration", () => {
    const sql = readFileSync(
      join(DIR, "20261114120000_per_school_behaviour.sql"),
      "utf8",
    );
    expect(sql).not.toMatch(/cron\.unschedule/);
  });
});
