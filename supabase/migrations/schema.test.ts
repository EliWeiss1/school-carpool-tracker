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

/** Resolves true when the query was rejected, false when it unexpectedly succeeded. */
async function isDenied(sql: string): Promise<boolean> {
  try {
    await db.query(sql);
    return false;
  } catch {
    return true;
  }
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(BOOTSTRAP);

  const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  expect(migrations.length, "no migration files found").toBeGreaterThan(0);

  for (const file of migrations) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
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
    expect(res.rows.map((r) => r.cmd)).toEqual(
      res.rows.map(() => "SELECT"),
    );
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
    await db.query("update public.carpools set name = 'Renamed Carpool' where id = $1", [
      carpoolId,
    ]);
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
    expect(names.indexOf("EC Hummingbirds")).toBeLessThan(
      names.indexOf("K1"),
    );
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
