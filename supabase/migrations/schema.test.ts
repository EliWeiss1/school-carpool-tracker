import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

/**
 * Runs the real migration files against an in-process Postgres so the schema,
 * the arrived_at trigger, and — most importantly — the RLS boundary are checked
 * by execution rather than by reading the SQL. Needs no Docker and touches no
 * hosted project.
 *
 * PGlite is a bare Postgres, so the harness first recreates the pieces the
 * Supabase platform normally provides: the anon / authenticated / service_role
 * roles and the `supabase_realtime` publication.
 */

const MIGRATIONS_DIR = dirname(fileURLToPath(import.meta.url));

const BOOTSTRAP = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  -- Supabase grants table privileges to anon, authenticated AND service_role
  -- platform-side by default (RLS, and each migration's own explicit
  -- REVOKE, are what actually narrow that); default privileges are the
  -- closest local equivalent. Granting only service_role here would make
  -- every "anon is denied" assertion below pass because anon was never
  -- granted anything in the first place, not because a migration's REVOKE
  -- did its job -- a regression guard that can't fail is not a guard.
  alter default privileges in schema public
    grant all on tables to anon, authenticated, service_role;
  create publication supabase_realtime;
`;

let db: PGlite;

async function asRole<T>(role: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

/** The SQLSTATE a query failed with, or null when it unexpectedly succeeded. */
async function errorCodeOf(
  sql: string,
  params: unknown[] = [],
): Promise<string | null> {
  try {
    await db.query(sql, params);
    return null;
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    return typeof code === "string" ? code : "unknown";
  }
}

/** Resolves true when the query was rejected, false when it unexpectedly succeeded. */
async function isDenied(sql: string): Promise<boolean> {
  try {
    await db.query(sql);
    return false;
  } catch {
    return true;
  }
}

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

async function applyMigration(target: PGlite, file: string): Promise<void> {
  await target.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
}

/**
 * Applies every migration in filename order. With `through`, stops after that
 * file (inclusive) -- how a test reproduces "the database as it was before
 * migration X" to check X's backfill against data the old schema allowed.
 */
async function applyMigrations(
  target: PGlite,
  through?: string,
): Promise<void> {
  const files = migrationFiles();
  expect(files.length, "no migration files found").toBeGreaterThan(0);
  if (through !== undefined) {
    expect(files, `cutoff ${through} not found`).toContain(through);
  }
  for (const file of files) {
    await applyMigration(target, file);
    if (file === through) return;
  }
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(BOOTSTRAP);
  await applyMigrations(db);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

async function insertStudent(
  last: string,
  status: "waiting" | "arrived" = "waiting",
): Promise<string> {
  const res = await db.query<{ id: string }>(
    "insert into public.students (first_name, last_name, status) values ($1, $2, $3) returning id",
    ["Test", last, status],
  );
  return res.rows[0].id;
}

async function readStudent(id: string) {
  const res = await db.query<{
    status: string;
    arrived_at: Date | null;
    updated_at: Date;
  }>(
    "select status, arrived_at, updated_at from public.students where id = $1",
    [id],
  );
  return res.rows[0];
}

describe("arrived_at is derived from the status transition", () => {
  it("leaves arrived_at null for a waiting student", async () => {
    const id = await insertStudent("Waiting");
    expect((await readStudent(id)).arrived_at).toBeNull();
  });

  it("stamps arrived_at when a student flips to arrived", async () => {
    const id = await insertStudent("Flipper");
    await db.query(
      "update public.students set status = 'arrived' where id = $1",
      [id],
    );
    expect((await readStudent(id)).arrived_at).not.toBeNull();
  });

  it("stamps arrived_at even when a row is inserted already arrived", async () => {
    const id = await insertStudent("BornArrived", "arrived");
    expect((await readStudent(id)).arrived_at).not.toBeNull();
  });

  it("clears arrived_at on a reset back to waiting", async () => {
    const id = await insertStudent("Resettable", "arrived");
    await db.query(
      "update public.students set status = 'waiting' where id = $1",
      [id],
    );
    expect((await readStudent(id)).arrived_at).toBeNull();
  });

  it("does not move arrived_at when an unrelated column is edited", async () => {
    const id = await insertStudent("Renamed", "arrived");
    const before = (await readStudent(id)).arrived_at;
    await db.query(
      "update public.students set class_group = '4th' where id = $1",
      [id],
    );
    expect((await readStudent(id)).arrived_at?.getTime()).toBe(
      before?.getTime(),
    );
  });

  it("ignores an arrived_at supplied by the caller", async () => {
    // The Edge Function is trusted, but a bug there must not be able to write a
    // 1999 arrival time onto the board.
    const res = await db.query<{ arrived_at: Date }>(
      "insert into public.students (first_name, last_name, status, arrived_at) values ('Test', 'Liar', 'arrived', '1999-01-01') returning arrived_at",
    );
    expect(res.rows[0].arrived_at.getFullYear()).toBeGreaterThan(2000);
  });
});

describe("constraints", () => {
  it("rejects a status outside waiting/arrived", async () => {
    expect(
      await isDenied(
        "insert into public.students (first_name, last_name, status) values ('A', 'B', 'enroute')",
      ),
    ).toBe(true);
  });

  it("rejects a status_events source outside the allowed set", async () => {
    expect(
      await isDenied(
        "insert into public.status_events (changed_to, source) values ('arrived', 'telepathy')",
      ),
    ).toBe(true);
  });

  it("keeps the audit row when its student is deleted", async () => {
    const id = await insertStudent("Departing");
    await db.query(
      "insert into public.status_events (student_id, changed_to, source, raw_transcript) values ($1, 'arrived', 'voice', 'departing')",
      [id],
    );
    await db.query("delete from public.students where id = $1", [id]);

    const res = await db.query<{ student_id: string | null }>(
      "select student_id from public.status_events where raw_transcript = 'departing'",
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].student_id).toBeNull();
  });
});

describe("grade removed", () => {
  it("has no grade column on students", async () => {
    const res = await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'students' and column_name = 'grade'",
    );
    expect(res.rows).toHaveLength(0);
  });
});

describe("RLS boundary", () => {
  it("lets anon read the roster", async () => {
    await insertStudent("Readable");
    const rows = await asRole("anon", async () => {
      const res = await db.query("select id from public.students");
      return res.rows;
    });
    expect(rows.length).toBeGreaterThan(0);
  });

  it.each([
    [
      "insert",
      "insert into public.students (first_name, last_name) values ('Mal', 'Actor')",
    ],
    ["update", "update public.students set status = 'arrived'"],
    ["delete", "delete from public.students"],
  ])("blocks anon %s on students", async (_label, sql) => {
    expect(await asRole("anon", () => isDenied(sql))).toBe(true);
  });

  it.each([
    [
      "insert",
      "insert into public.students (first_name, last_name) values ('Mal', 'Actor')",
    ],
    ["update", "update public.students set status = 'arrived'"],
    ["delete", "delete from public.students"],
  ])("blocks authenticated %s on students", async (_label, sql) => {
    expect(await asRole("authenticated", () => isDenied(sql))).toBe(true);
  });

  it("hides status_events from anon entirely", async () => {
    // It can hold a raw transcript, so it is not readable even though it is
    // never rendered anywhere in the UI.
    expect(
      await asRole("anon", () =>
        isDenied("select * from public.status_events"),
      ),
    ).toBe(true);
    expect(
      await asRole("anon", () =>
        isDenied(
          "insert into public.status_events (changed_to, source) values ('arrived', 'voice')",
        ),
      ),
    ).toBe(true);
  });

  it("still lets the service role write both tables", async () => {
    await asRole("service_role", async () => {
      const res = await db.query<{ id: string }>(
        "insert into public.students (first_name, last_name) values ('Service', 'Role') returning id",
      );
      const id = res.rows[0].id;
      await db.query(
        "update public.students set status = 'arrived' where id = $1",
        [id],
      );
      await db.query(
        "insert into public.status_events (student_id, changed_to, source, match_confidence) values ($1, 'arrived', 'voice', 0.91)",
        [id],
      );
    });
  });

  it("has RLS enabled on both tables", async () => {
    const res = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relname in ('students', 'status_events')",
    );
    expect(res.rows).toHaveLength(2);
    for (const row of res.rows) {
      expect(row.relrowsecurity, `${row.relname} RLS`).toBe(true);
    }
  });

  it("defines no write policy anywhere — that absence is the boundary", async () => {
    const res = await db.query<{ cmd: string }>(
      "select cmd from pg_policies where schemaname = 'public'",
    );
    // One SELECT-only policy per publicly-readable table (students,
    // class_groups) -- never an insert/update/delete policy anywhere.
    expect(res.rows.map((r) => r.cmd)).toEqual(res.rows.map(() => "SELECT"));
    expect(res.rows.length).toBeGreaterThan(0);
  });
});

describe("carpools", () => {
  async function insertCarpool(name: string): Promise<string> {
    const res = await db.query<{ id: string }>(
      "insert into public.carpools (name) values ($1) returning id",
      [name],
    );
    return res.rows[0].id;
  }

  it("hides carpools from anon entirely, read and write", async () => {
    await insertCarpool("Readable Carpool");
    expect(
      await asRole("anon", () => isDenied("select * from public.carpools")),
    ).toBe(true);
    expect(
      await asRole("anon", () =>
        isDenied("insert into public.carpools (name) values ('Mal Actor')"),
      ),
    ).toBe(true);
  });

  it("hides carpools from authenticated too", async () => {
    expect(
      await asRole("authenticated", () =>
        isDenied("select * from public.carpools"),
      ),
    ).toBe(true);
  });

  it("still lets the service role manage carpools", async () => {
    await asRole("service_role", async () => {
      const res = await db.query<{ id: string }>(
        "insert into public.carpools (name) values ('Service Carpool') returning id",
      );
      expect(res.rows[0].id).toBeTruthy();
    });
  });

  it("rejects two carpools with the same name, case-insensitively", async () => {
    await insertCarpool("Weiss Carpool");
    expect(
      await isDenied(
        "insert into public.carpools (name) values ('weiss carpool')",
      ),
    ).toBe(true);
  });

  it("nulls a student's carpool_id when the carpool is deleted, without deleting the student", async () => {
    const carpoolId = await insertCarpool("Vanishing Carpool");
    const studentId = await insertStudent("Rider");
    await db.query("update public.students set carpool_id = $1 where id = $2", [
      carpoolId,
      studentId,
    ]);

    await db.query("delete from public.carpools where id = $1", [carpoolId]);

    const res = await db.query<{ carpool_id: string | null }>(
      "select carpool_id from public.students where id = $1",
      [studentId],
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].carpool_id).toBeNull();
  });

  it("nulls a status_events row's carpool_id when the carpool is deleted", async () => {
    const carpoolId = await insertCarpool("Audited Carpool");
    const studentId = await insertStudent("Logged");
    await db.query(
      "insert into public.status_events (student_id, carpool_id, changed_to, source) values ($1, $2, 'arrived', 'voice')",
      [studentId, carpoolId],
    );

    await db.query("delete from public.carpools where id = $1", [carpoolId]);

    const res = await db.query<{ carpool_id: string | null }>(
      "select carpool_id from public.status_events where student_id = $1",
      [studentId],
    );
    expect(res.rows[0].carpool_id).toBeNull();
  });

  it("touches updated_at when a carpool is edited", async () => {
    const carpoolId = await insertCarpool("Renaming Carpool");
    const before = await db.query<{ updated_at: Date }>(
      "select updated_at from public.carpools where id = $1",
      [carpoolId],
    );
    await db.query(
      "update public.carpools set name = 'Renamed Carpool' where id = $1",
      [carpoolId],
    );
    const after = await db.query<{ updated_at: Date }>(
      "select updated_at from public.carpools where id = $1",
      [carpoolId],
    );
    expect(after.rows[0].updated_at.getTime()).toBeGreaterThanOrEqual(
      before.rows[0].updated_at.getTime(),
    );
  });

  it("has RLS enabled with no policy at all", async () => {
    const res = await db.query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where relname = 'carpools'",
    );
    expect(res.rows[0].relrowsecurity).toBe(true);

    const policies = await db.query(
      "select 1 from pg_policies where schemaname = 'public' and tablename = 'carpools'",
    );
    expect(policies.rows).toHaveLength(0);
  });
});

describe("student_parents", () => {
  it("hides parent names from anon entirely, read and write", async () => {
    const studentId = await insertStudent("Weiss");
    await db.query(
      "insert into public.student_parents (student_id, parent1_name) values ($1, 'Eli Weiss')",
      [studentId],
    );

    expect(
      await asRole("anon", () =>
        isDenied("select * from public.student_parents"),
      ),
    ).toBe(true);
    expect(
      await asRole("anon", () =>
        isDenied(
          "insert into public.student_parents (student_id, parent1_name) values (gen_random_uuid(), 'Mal Actor')",
        ),
      ),
    ).toBe(true);
  });

  it("hides parent names from authenticated too", async () => {
    expect(
      await asRole("authenticated", () =>
        isDenied("select * from public.student_parents"),
      ),
    ).toBe(true);
  });

  it("still lets the service role manage parent names", async () => {
    const studentId = await insertStudent("Cohen");
    await asRole("service_role", async () => {
      const res = await db.query<{ student_id: string }>(
        "insert into public.student_parents (student_id, parent1_name, parent2_name) values ($1, 'Maya Cohen', 'Aaron Cohen') returning student_id",
        [studentId],
      );
      expect(res.rows[0].student_id).toBe(studentId);
    });
  });

  it("is not exposed anywhere a select * on students would reach it", async () => {
    // The whole point of the separate table: students' own columns are
    // completely untouched by this feature, so the existing public-read
    // policy on students is unaffected.
    await insertStudent("Untouched");
    const rows = await asRole("anon", async () => {
      const res = await db.query("select * from public.students");
      return res.rows;
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows as Record<string, unknown>[]) {
      expect(row).not.toHaveProperty("parent1_name");
      expect(row).not.toHaveProperty("parent2_name");
    }
  });

  it("deletes the parent-name row when the student is removed", async () => {
    const studentId = await insertStudent("Departing");
    await db.query(
      "insert into public.student_parents (student_id, parent1_name) values ($1, 'Gone Parent')",
      [studentId],
    );
    await db.query("delete from public.students where id = $1", [studentId]);

    const res = await db.query(
      "select 1 from public.student_parents where student_id = $1",
      [studentId],
    );
    expect(res.rows).toHaveLength(0);
  });

  it("touches updated_at when a parent name is edited", async () => {
    const studentId = await insertStudent("Renaming");
    await db.query(
      "insert into public.student_parents (student_id, parent1_name) values ($1, 'Old Name')",
      [studentId],
    );
    const before = await db.query<{ updated_at: Date }>(
      "select updated_at from public.student_parents where student_id = $1",
      [studentId],
    );
    await db.query(
      "update public.student_parents set parent1_name = 'New Name' where student_id = $1",
      [studentId],
    );
    const after = await db.query<{ updated_at: Date }>(
      "select updated_at from public.student_parents where student_id = $1",
      [studentId],
    );
    expect(after.rows[0].updated_at.getTime()).toBeGreaterThanOrEqual(
      before.rows[0].updated_at.getTime(),
    );
  });

  it("has RLS enabled with no policy at all", async () => {
    const res = await db.query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where relname = 'student_parents'",
    );
    expect(res.rows[0].relrowsecurity).toBe(true);

    const policies = await db.query(
      "select 1 from pg_policies where schemaname = 'public' and tablename = 'student_parents'",
    );
    expect(policies.rows).toHaveLength(0);
  });

  it("is never added to the realtime publication", async () => {
    const res = await db.query<{ tablename: string }>(
      "select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'",
    );
    expect(res.rows.map((r) => r.tablename)).not.toContain("student_parents");
  });
});

describe("class groups", () => {
  it("comes seeded with the EC classes before K1", async () => {
    const res = await db.query<{ name: string }>(
      "select name from public.class_groups order by sort_order",
    );
    const names = res.rows.map((r) => r.name);
    expect(names.indexOf("EC Hummingbirds")).toBeLessThan(names.indexOf("K1"));
    expect(names).toContain("5th");
  });

  it("lets anon read the class list but not write it", async () => {
    const rows = await asRole("anon", async () => {
      const res = await db.query("select id from public.class_groups");
      return res.rows;
    });
    expect(rows.length).toBeGreaterThan(0);

    expect(
      await asRole("anon", () =>
        isDenied(
          "insert into public.class_groups (name, sort_order) values ('Mal Actor', 99)",
        ),
      ),
    ).toBe(true);
  });

  it("rejects two classes with the same name, case-insensitively", async () => {
    await db.query(
      "insert into public.class_groups (name, sort_order) values ('Test Class', 50)",
    );
    expect(
      await isDenied(
        "insert into public.class_groups (name, sort_order) values ('test class', 51)",
      ),
    ).toBe(true);
  });

  it("still lets the service role manage the class list", async () => {
    await asRole("service_role", async () => {
      const res = await db.query<{ id: string }>(
        "insert into public.class_groups (name, sort_order) values ('Service Class', 60) returning id",
      );
      expect(res.rows[0].id).toBeTruthy();
    });
  });
});

describe("realtime wiring", () => {
  it("publishes students and not status_events", async () => {
    const res = await db.query<{ tablename: string }>(
      "select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'",
    );
    const published = res.rows.map((r) => r.tablename);
    expect(published).toContain("students");
    expect(published).not.toContain("status_events");
  });

  it("uses FULL replica identity so updates carry the previous status", async () => {
    const res = await db.query<{ relreplident: string }>(
      "select relreplident from pg_class where relname = 'students'",
    );
    expect(res.rows[0].relreplident).toBe("f");
  });

  it("is safe to re-run when students is already published", async () => {
    // Guards the DO block: a fresh `supabase db push` onto a project that
    // already has the table published must not error out.
    await expect(
      db.exec(`do $$
        begin
          if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'students'
          ) then
            alter publication supabase_realtime add table public.students;
          end if;
        end;
        $$;`),
    ).resolves.toBeDefined();
  });
});

describe("nightly board reset", () => {
  const nightly = (at: string) =>
    db.query<{ n: number | null }>(
      "select public.nightly_reset_board($1::timestamptz) as n",
      [at],
    );

  async function statusOf(id: string): Promise<string> {
    return (await readStudent(id)).status;
  }

  async function adminResetRows(id: string): Promise<number> {
    const res = await db.query<{ n: number }>(
      "select count(*)::int as n from public.status_events where student_id = $1 and changed_to = 'waiting' and source = 'admin'",
      [id],
    );
    return res.rows[0].n;
  }

  it("resets arrived students at 8 PM Pacific in daylight time and logs each", async () => {
    const arrived = await insertStudent("NightlyDst", "arrived");
    const waiting = await insertStudent("NightlyDstWaiting");

    // Monday 2026-10-12 20:00 PDT == 03:00 UTC on the 13th.
    const res = await nightly("2026-10-13T03:00:00Z");

    expect(res.rows[0].n).toBeGreaterThanOrEqual(1);
    expect(await statusOf(arrived)).toBe("waiting");
    expect((await readStudent(arrived)).arrived_at).toBeNull();
    expect(await adminResetRows(arrived)).toBe(1);
    // A child who was already waiting is neither touched nor audited.
    expect(await adminResetRows(waiting)).toBe(0);
  });

  it("still fires at 8 PM Pacific in standard time (04:00 UTC)", async () => {
    const id = await insertStudent("NightlyPst", "arrived");
    // Monday 2026-12-07 20:00 PST == 04:00 UTC on the 8th.
    await nightly("2026-12-08T04:00:00Z");
    expect(await statusOf(id)).toBe("waiting");
  });

  it("does nothing at the UTC hour that is not 8 PM Pacific", async () => {
    const summer = await insertStudent("NightlyWrongHourSummer", "arrived");
    // 04:00 UTC in daylight time is 9 PM Pacific.
    expect((await nightly("2026-10-13T04:00:00Z")).rows[0].n).toBeNull();
    expect(await statusOf(summer)).toBe("arrived");

    // 03:00 UTC in standard time is 7 PM Pacific.
    expect((await nightly("2026-12-08T03:00:00Z")).rows[0].n).toBeNull();
    expect(await statusOf(summer)).toBe("arrived");
  });

  it("skips Friday and Saturday night but runs Sunday through Thursday", async () => {
    const id = await insertStudent("NightlyWeekend", "arrived");

    // Friday 2026-10-16 20:00 PDT == 03:00 UTC Saturday the 17th.
    expect((await nightly("2026-10-17T03:00:00Z")).rows[0].n).toBeNull();
    expect(await statusOf(id)).toBe("arrived");

    // Saturday 2026-10-17 20:00 PDT == 03:00 UTC Sunday the 18th.
    expect((await nightly("2026-10-18T03:00:00Z")).rows[0].n).toBeNull();
    expect(await statusOf(id)).toBe("arrived");

    // Thursday 2026-10-15 20:00 PDT == 03:00 UTC Friday the 16th.
    await nightly("2026-10-16T03:00:00Z");
    expect(await statusOf(id)).toBe("waiting");

    // Sunday 2026-10-11 20:00 PDT == 03:00 UTC Monday the 12th.
    await db.query(
      "update public.students set status = 'arrived' where id = $1",
      [id],
    );
    await nightly("2026-10-12T03:00:00Z");
    expect(await statusOf(id)).toBe("waiting");
  });

  it("is a no-op, writing no audit rows, when nobody is arrived", async () => {
    await db.exec("update public.students set status = 'waiting'");
    const before = await db.query<{ n: number }>(
      "select count(*)::int as n from public.status_events",
    );
    const res = await nightly("2026-10-13T03:00:00Z");
    const after = await db.query<{ n: number }>(
      "select count(*)::int as n from public.status_events",
    );
    expect(res.rows[0].n).toBe(0);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("cannot be called by anon or authenticated", async () => {
    for (const role of ["anon", "authenticated"]) {
      await asRole(role, async () => {
        expect(
          await isDenied("select public.reset_board_to_waiting()"),
          `${role} reached reset_board_to_waiting`,
        ).toBe(true);
        expect(
          await isDenied("select public.nightly_reset_board()"),
          `${role} reached nightly_reset_board`,
        ).toBe(true);
      });
    }
  });
});

describe("student_classes", () => {
  const STUDENT_CLASSES_MIGRATION = "20261021120000_student_classes.sql";
  const CLASS_GROUPS_MIGRATION = "20260916010000_class_groups.sql";
  let classCounter = 0;

  async function insertClass(name?: string): Promise<string> {
    classCounter += 1;
    const res = await db.query<{ id: string }>(
      "insert into public.class_groups (name, sort_order) values ($1, $2) returning id",
      [name ?? `SC Test Class ${classCounter}`, 1000 + classCounter],
    );
    return res.rows[0].id;
  }

  async function link(studentId: string, classId: string): Promise<void> {
    await db.query(
      "insert into public.student_classes (student_id, class_group_id) values ($1, $2)",
      [studentId, classId],
    );
  }

  async function classesOf(studentId: string): Promise<string[]> {
    const res = await db.query<{ class_group_id: string }>(
      "select class_group_id from public.student_classes where student_id = $1 order by class_group_id",
      [studentId],
    );
    return res.rows.map((r) => r.class_group_id);
  }

  async function membersOf(classId: string): Promise<string[]> {
    const res = await db.query<{ student_id: string }>(
      "select student_id from public.student_classes where class_group_id = $1 order by student_id",
      [classId],
    );
    return res.rows.map((r) => r.student_id);
  }

  async function classExists(classId: string): Promise<boolean> {
    const res = await db.query(
      "select 1 from public.class_groups where id = $1",
      [classId],
    );
    return res.rows.length === 1;
  }

  const sorted = (ids: string[]) => [...ids].sort();

  describe("table", () => {
    it("rejects a duplicate (student, class) pair", async () => {
      const s = await insertStudent("DupLink");
      const c = await insertClass();
      await link(s, c);
      expect(
        await errorCodeOf(
          "insert into public.student_classes (student_id, class_group_id) values ($1, $2)",
          [s, c],
        ),
      ).toBe("23505");
    });

    it("rejects a link to a nonexistent student or class", async () => {
      const s = await insertStudent("OrphanLink");
      const c = await insertClass();
      expect(
        await errorCodeOf(
          "insert into public.student_classes (student_id, class_group_id) values (gen_random_uuid(), $1)",
          [c],
        ),
      ).toBe("23503");
      expect(
        await errorCodeOf(
          "insert into public.student_classes (student_id, class_group_id) values ($1, gen_random_uuid())",
          [s],
        ),
      ).toBe("23503");
    });

    it("deleting a student removes only their links", async () => {
      const gone = await insertStudent("LinkGone");
      const stays = await insertStudent("LinkStays");
      const c = await insertClass();
      await link(gone, c);
      await link(stays, c);
      await db.query("delete from public.students where id = $1", [gone]);
      expect(await membersOf(c)).toEqual([stays]);
    });

    it("deleting a class removes only its links and keeps the students", async () => {
      const s = await insertStudent("ClassGone");
      const gone = await insertClass();
      const stays = await insertClass();
      await link(s, gone);
      await link(s, stays);
      await db.query("delete from public.class_groups where id = $1", [gone]);
      expect(await classesOf(s)).toEqual([stays]);
      const res = await db.query(
        "select 1 from public.students where id = $1",
        [s],
      );
      expect(res.rows).toHaveLength(1);
    });

    it("anon can select student_classes but not insert, update or delete", async () => {
      const s = await insertStudent("AnonLink");
      const c = await insertClass();
      await link(s, c);

      const rows = await asRole("anon", async () => {
        const res = await db.query("select * from public.student_classes");
        return res.rows;
      });
      expect(rows.length).toBeGreaterThan(0);

      for (const role of ["anon", "authenticated"]) {
        for (const sql of [
          `insert into public.student_classes (student_id, class_group_id) values ('${s}', '${c}')`,
          `update public.student_classes set created_at = now()`,
          `delete from public.student_classes`,
        ]) {
          expect(
            await asRole(role, () => isDenied(sql)),
            `${role}: ${sql}`,
          ).toBe(true);
        }
      }
      expect(await membersOf(c)).toEqual([s]);
    });

    it("service_role can write", async () => {
      const s = await insertStudent("ServiceLink");
      const c = await insertClass();
      await asRole("service_role", async () => {
        await db.query(
          "insert into public.student_classes (student_id, class_group_id) values ($1, $2)",
          [s, c],
        );
        await db.query(
          "delete from public.student_classes where student_id = $1",
          [s],
        );
      });
      expect(await classesOf(s)).toEqual([]);
    });

    it("has RLS on with exactly one SELECT policy", async () => {
      const rls = await db.query<{ relrowsecurity: boolean }>(
        "select relrowsecurity from pg_class where relname = 'student_classes'",
      );
      expect(rls.rows[0].relrowsecurity).toBe(true);
      const policies = await db.query<{ cmd: string }>(
        "select cmd from pg_policies where schemaname = 'public' and tablename = 'student_classes'",
      );
      expect(policies.rows.map((r) => r.cmd)).toEqual(["SELECT"]);
    });

    it("is in the realtime publication and has the class-first index", async () => {
      const pub = await db.query<{ tablename: string }>(
        "select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'",
      );
      expect(pub.rows.map((r) => r.tablename)).toContain("student_classes");
      const idx = await db.query<{ indexdef: string }>(
        "select indexdef from pg_indexes where schemaname = 'public' and indexname = 'student_classes_class_idx'",
      );
      expect(idx.rows).toHaveLength(1);
      expect(idx.rows[0].indexdef).toMatch(/\(class_group_id, student_id\)/);
    });
  });

  describe("set_student_classes", () => {
    const setClasses = (studentId: string, classIds: string[]) =>
      db.query("select public.set_student_classes($1::uuid, $2::uuid[])", [
        studentId,
        classIds,
      ]);

    it("replaces the set atomically", async () => {
      const s = await insertStudent("SetClasses");
      const [a, b, c] = [
        await insertClass(),
        await insertClass(),
        await insertClass(),
      ];
      await link(s, a);
      await link(s, b);

      await setClasses(s, [b, c]);
      expect(await classesOf(s)).toEqual(sorted([b, c]));

      // Duplicates in the input are harmless; an empty set clears it.
      await setClasses(s, [c, c]);
      expect(await classesOf(s)).toEqual([c]);
      await setClasses(s, []);
      expect(await classesOf(s)).toEqual([]);
    });

    it("errors for an unknown student and leaves existing links intact", async () => {
      const s = await insertStudent("SetClassesKeep");
      const c = await insertClass();
      await link(s, c);
      expect(
        await errorCodeOf(
          "select public.set_student_classes(gen_random_uuid(), $1::uuid[])",
          [[c]],
        ),
      ).not.toBeNull();
      expect(await membersOf(c)).toEqual([s]);
    });

    it("rolls back the whole replacement when one class does not exist", async () => {
      const s = await insertStudent("SetClassesRollback");
      const [a, b] = [await insertClass(), await insertClass()];
      await link(s, a);
      expect(
        await errorCodeOf(
          "select public.set_student_classes($1::uuid, array[$2::uuid, gen_random_uuid()])",
          [s, b],
        ),
      ).toBe("23503");
      expect(await classesOf(s)).toEqual([a]);
    });
  });

  describe("change_class_members", () => {
    const change = async (classId: string, add: string[], remove: string[]) => {
      const res = await db.query<{
        r: { member_count: number; ignored_ids: string[] };
      }>(
        "select public.change_class_members($1::uuid, $2::uuid[], $3::uuid[]) as r",
        [classId, add, remove],
      );
      return res.rows[0].r;
    };

    it("adds, is idempotent on re-add, removes, and reports ignored ids", async () => {
      const c = await insertClass();
      const s1 = await insertStudent("Bulk1");
      const s2 = await insertStudent("Bulk2");
      const ghost = "00000000-0000-4000-8000-000000000001";

      const added = await change(c, [s1, s2, ghost], []);
      expect(added.member_count).toBe(2);
      expect(added.ignored_ids).toEqual([ghost]);
      expect(await membersOf(c)).toEqual(sorted([s1, s2]));

      const again = await change(c, [s1], []);
      expect(again.member_count).toBe(2);
      expect(again.ignored_ids).toEqual([]);

      const removed = await change(c, [], [s1]);
      expect(removed.member_count).toBe(1);
      expect(await membersOf(c)).toEqual([s2]);
    });

    it("raises P0002 for a missing class", async () => {
      const s = await insertStudent("BulkMissing");
      expect(
        await errorCodeOf(
          "select public.change_class_members(gen_random_uuid(), $1::uuid[], '{}'::uuid[])",
          [[s]],
        ),
      ).toBe("P0002");
      expect(await classesOf(s)).toEqual([]);
    });
  });

  describe("remove_class_group", () => {
    type RemoveResult = {
      deleted: boolean;
      moved_count?: number;
      member_count?: number;
      sole_member_count?: number;
      sole_members?: { id: string; first_name: string; last_name: string }[];
    };
    const remove = async (
      classId: string,
      moveTo: string | null = null,
      force = false,
    ): Promise<RemoveResult> => {
      const res = await db.query<{ r: RemoveResult }>(
        "select public.remove_class_group($1::uuid, $2::uuid, $3::boolean) as r",
        [classId, moveTo, force],
      );
      return res.rows[0].r;
    };

    it("deletes when there are no sole members", async () => {
      const c = await insertClass();
      const other = await insertClass();
      const s = await insertStudent("NotSole");
      await link(s, c);
      await link(s, other);

      const r = await remove(c);
      expect(r.deleted).toBe(true);
      expect(await classExists(c)).toBe(false);
      expect(await classesOf(s)).toEqual([other]);
    });

    it("deletes an empty class", async () => {
      const c = await insertClass();
      expect((await remove(c)).deleted).toBe(true);
      expect(await classExists(c)).toBe(false);
    });

    it("deletes nothing and reports sole members when neither option is given", async () => {
      const c = await insertClass();
      const other = await insertClass();
      const sole = await insertStudent("SoleOne");
      const shared = await insertStudent("SharedOne");
      await link(sole, c);
      await link(shared, c);
      await link(shared, other);

      const r = await remove(c);
      expect(r.deleted).toBe(false);
      expect(r.member_count).toBe(2);
      expect(r.sole_member_count).toBe(1);
      expect(r.sole_members).toEqual([
        { id: sole, first_name: "Test", last_name: "SoleOne" },
      ]);
      expect(await classExists(c)).toBe(true);
      expect(await membersOf(c)).toEqual(sorted([sole, shared]));
    });

    it("caps the sole-member sample at 10", async () => {
      const c = await insertClass();
      for (let i = 0; i < 12; i++) {
        await link(await insertStudent(`SoleCap${i}`), c);
      }
      const r = await remove(c);
      expect(r.deleted).toBe(false);
      expect(r.sole_member_count).toBe(12);
      expect(r.sole_members).toHaveLength(10);
    });

    it("with p_move_to links every member to the target and deletes the class", async () => {
      const c = await insertClass();
      const target = await insertClass();
      const third = await insertClass();
      const sole = await insertStudent("MoveSole");
      const multi = await insertStudent("MoveMulti");
      const already = await insertStudent("MoveAlready");
      await link(sole, c);
      await link(multi, c);
      await link(multi, third);
      await link(already, c);
      await link(already, target);

      const r = await remove(c, target);
      expect(r.deleted).toBe(true);
      expect(r.moved_count).toBe(3);
      expect(await classExists(c)).toBe(false);
      expect(await classesOf(sole)).toEqual([target]);
      expect(await classesOf(multi)).toEqual(sorted([target, third]));
      expect(await classesOf(already)).toEqual([target]);
    });

    it("with p_force deletes and leaves the sole member with no links", async () => {
      const c = await insertClass();
      const sole = await insertStudent("ForceSole");
      await link(sole, c);

      const r = await remove(c, null, true);
      expect(r.deleted).toBe(true);
      expect(await classExists(c)).toBe(false);
      expect(await classesOf(sole)).toEqual([]);
    });

    it("never counts a two-class student as a sole member", async () => {
      const c = await insertClass();
      const other = await insertClass();
      const s = await insertStudent("TwoClass");
      await link(s, c);
      await link(s, other);
      const lone = await insertStudent("TwoClassLone");
      await link(lone, c);

      const r = await remove(c);
      expect(r.deleted).toBe(false);
      expect(r.sole_member_count).toBe(1);
      expect(r.sole_members?.map((m) => m.id)).toEqual([lone]);
    });

    it("raises 22023 for p_move_to equal to the class or nonexistent, and rolls back", async () => {
      const c = await insertClass();
      const s = await insertStudent("MoveInvalid");
      await link(s, c);

      expect(
        await errorCodeOf(
          "select public.remove_class_group($1::uuid, $1::uuid, false)",
          [c],
        ),
      ).toBe("22023");
      expect(
        await errorCodeOf(
          "select public.remove_class_group($1::uuid, gen_random_uuid(), false)",
          [c],
        ),
      ).toBe("22023");
      expect(await classExists(c)).toBe(true);
      expect(await classesOf(s)).toEqual([c]);
    });

    it("raises P0002 for a missing class", async () => {
      expect(
        await errorCodeOf(
          "select public.remove_class_group(gen_random_uuid(), null, false)",
        ),
      ).toBe("P0002");
    });
  });

  describe("privileges", () => {
    const calls = [
      "select public.set_student_classes(gen_random_uuid(), '{}'::uuid[])",
      "select public.change_class_members(gen_random_uuid(), '{}'::uuid[], '{}'::uuid[])",
      "select public.remove_class_group(gen_random_uuid())",
      "select public.backfill_student_classes()",
    ];

    it("anon and authenticated cannot execute set_student_classes, change_class_members, remove_class_group, backfill_student_classes", async () => {
      for (const role of ["anon", "authenticated"]) {
        for (const sql of calls) {
          const code = await asRole(role, () => errorCodeOf(sql));
          expect(code, `${role}: ${sql}`).toBe("42501");
        }
      }
    });

    it("service_role can execute them", async () => {
      const s = await insertStudent("ServiceRpc");
      const c = await insertClass();
      await asRole("service_role", async () => {
        await db.query(
          "select public.set_student_classes($1::uuid, $2::uuid[])",
          [s, [c]],
        );
        await db.query(
          "select public.change_class_members($1::uuid, '{}'::uuid[], $2::uuid[])",
          [c, [s]],
        );
        await db.query("select public.remove_class_group($1::uuid)", [c]);
        await db.query("select public.backfill_student_classes()");
      });
      expect(await classExists(c)).toBe(false);
    });
  });

  describe("backfill", () => {
    it("links existing free-text classes, creates missing ones, and is idempotent", async () => {
      const old = await PGlite.create();
      try {
        await old.exec(BOOTSTRAP);
        await applyMigrations(old, CLASS_GROUPS_MIGRATION);

        const ins = async (last: string, cls: string | null) =>
          (
            await old.query<{ id: string }>(
              "insert into public.students (first_name, last_name, class_group) values ('Old', $1, $2) returning id",
              [last, cls],
            )
          ).rows[0].id;
        const padded = await ins("Padded", " 3rd ");
        const shouted = await ins("Shouted", "3RD");
        const club = await ins("Club", "Art Club");
        const clubPadded = await ins("ClubPadded", " art club ");
        const blank = await ins("Blank", "");
        const spaces = await ins("Spaces", "   ");
        const none = await ins("None", null);

        const maxBefore = (
          await old.query<{ m: number }>(
            "select max(sort_order) as m from public.class_groups",
          )
        ).rows[0].m;

        await applyMigration(old, STUDENT_CLASSES_MIGRATION);

        const linksOf = async (id: string) =>
          (
            await old.query<{ name: string }>(
              "select g.name from public.student_classes sc join public.class_groups g on g.id = sc.class_group_id where sc.student_id = $1",
              [id],
            )
          ).rows.map((r) => r.name);

        expect(await linksOf(padded)).toEqual(["3rd"]);
        expect(await linksOf(shouted)).toEqual(["3rd"]);
        expect(await linksOf(club)).toEqual(["Art Club"]);
        expect(await linksOf(clubPadded)).toEqual(["Art Club"]);
        for (const id of [blank, spaces, none]) {
          expect(await linksOf(id)).toEqual([]);
        }

        const thirds = await old.query(
          "select 1 from public.class_groups where lower(name) = '3rd'",
        );
        expect(thirds.rows).toHaveLength(1);
        const art = await old.query<{ sort_order: number }>(
          "select sort_order from public.class_groups where lower(name) = 'art club'",
        );
        expect(art.rows).toHaveLength(1);
        expect(art.rows[0].sort_order).toBeGreaterThan(maxBefore);

        const counts = async () =>
          (
            await old.query<{ g: number; l: number }>(
              "select (select count(*)::int from public.class_groups) as g, (select count(*)::int from public.student_classes) as l",
            )
          ).rows[0];
        const before = await counts();
        await old.query("select public.backfill_student_classes()");
        expect(await counts()).toEqual(before);
      } finally {
        await old.close();
      }
    }, 60_000);
  });
});
