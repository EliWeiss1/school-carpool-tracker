import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  BOOTSTRAP,
  asRoleOn,
  asUserOn,
  insertAuthUser,
} from "./test-bootstrap";

/**
 * The multi-school EXPAND migration, tested by running it: the backfill of the
 * live single-school database, the composite foreign keys that make a
 * cross-school link impossible, per-school names, the row-level-security read
 * boundary for members, devices and the legacy public key, and the
 * school-scoped RPC overloads.
 *
 * Every isolation test seeds BOTH schools with rows that use identical names,
 * so "sees only A" cannot pass just because B happens to be empty.
 */

const MIGRATIONS_DIR = dirname(fileURLToPath(import.meta.url));
const EXPAND = "20261112120000_multi_school_expand.sql";
const BEFORE_EXPAND = "20261021130000_drop_student_class_group_column.sql";
const SCHOOL_1 = "00000000-0000-4000-8000-000000000001";

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/** Applies migrations in filename order, stopping after `through` if given. */
async function applyMigrations(
  target: PGlite,
  through?: string,
): Promise<void> {
  const files = migrationFiles();
  expect(files, "expand migration missing").toContain(EXPAND);
  for (const file of files) {
    await target.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    if (file === through) return;
  }
}

interface SqlError {
  code: string;
  message: string;
}

/** The error a statement fails with, or null if it unexpectedly succeeded. */
async function errorOf(
  target: PGlite,
  sql: string,
  params: unknown[] = [],
): Promise<SqlError | null> {
  try {
    await target.query(sql, params);
    return null;
  } catch (e) {
    const err = e as { code?: unknown; message?: unknown };
    return {
      code: typeof err.code === "string" ? err.code : "unknown",
      message: typeof err.message === "string" ? err.message : "",
    };
  }
}

async function rows<T extends object>(
  target: PGlite,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await target.query<T>(sql, params)).rows;
}

async function scalar<T>(
  target: PGlite,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  const res = await target.query<Record<string, T>>(sql, params);
  return Object.values(res.rows[0])[0];
}

interface SeededSchool {
  schoolId: string;
  studentId: string;
  siblingId: string;
  classId: string;
  carpoolId: string;
}

let slugCounter = 0;

/**
 * One school with a deliberately identical shape every time: same student,
 * class and carpool names, a link, a parent row and two audit rows.
 */
async function seedSchool(
  target: PGlite,
  label: string,
): Promise<SeededSchool> {
  slugCounter += 1;
  const schoolId = await scalar<string>(
    target,
    "insert into public.schools (name, slug) values ($1, $2) returning id",
    [`School ${label}`, `school-${label.toLowerCase()}-${slugCounter}`],
  );
  const carpoolId = await scalar<string>(
    target,
    "insert into public.carpools (school_id, name) values ($1, 'Cohen family') returning id",
    [schoolId],
  );
  const studentId = await scalar<string>(
    target,
    "insert into public.students (school_id, first_name, last_name, carpool_id) values ($1, 'Maya', 'Cohen', $2) returning id",
    [schoolId, carpoolId],
  );
  const siblingId = await scalar<string>(
    target,
    "insert into public.students (school_id, first_name, last_name, carpool_id) values ($1, 'Eli', 'Cohen', $2) returning id",
    [schoolId, carpoolId],
  );
  const classId = await scalar<string>(
    target,
    "insert into public.class_groups (school_id, name, sort_order) values ($1, 'Seed Class', 100) returning id",
    [schoolId],
  );
  await target.query(
    "insert into public.student_classes (school_id, student_id, class_group_id) values ($1, $2, $3)",
    [schoolId, studentId, classId],
  );
  await target.query(
    "insert into public.student_parents (school_id, student_id, parent1_name) values ($1, $2, 'Parent')",
    [schoolId, studentId],
  );
  await target.query(
    "insert into public.status_events (school_id, student_id, carpool_id, changed_to, source) values ($1, $2, $3, 'arrived', 'voice'), ($1, $2, null, 'waiting', 'manual')",
    [schoolId, studentId, carpoolId],
  );
  return { schoolId, studentId, siblingId, classId, carpoolId };
}

const DATA_TABLES = [
  "students",
  "class_groups",
  "carpools",
  "status_events",
  "student_parents",
  "student_classes",
] as const;

async function countBySchool(
  target: PGlite,
  table: string,
  schoolId: string,
): Promise<number> {
  return Number(
    await scalar<string | number>(
      target,
      `select count(*) from public.${table} where school_id = $1`,
      [schoolId],
    ),
  );
}

/** The distinct school ids present in a table as seen by the current role. */
async function visibleSchools(
  target: PGlite,
  table: string,
  column = "school_id",
): Promise<string[]> {
  const res = await rows<{ s: string }>(
    target,
    `select distinct ${column} as s from public.${table} order by 1`,
  );
  return res.map((r) => r.s);
}

let db: PGlite;
let A: SeededSchool;
let B: SeededSchool;

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(BOOTSTRAP);
  await applyMigrations(db);
  A = await seedSchool(db, "A");
  B = await seedSchool(db, "B");
  // A student in school #1, as the legacy anon key must keep seeing it.
  const legacyId = await scalar<string>(
    db,
    "insert into public.students (first_name, last_name) values ('Legacy', 'Student') returning id",
  );
  // ...and a class link, written the way old code writes it (no school_id).
  await db.query(
    "insert into public.student_classes (student_id, class_group_id) select $1, id from public.class_groups where school_id = $2 limit 1",
    [legacyId, SCHOOL_1],
  );
}, 60_000);

afterAll(async () => {
  await db?.close();
});

// ---------------------------------------------------------------------------

describe("backfill of the live single-school database", () => {
  let legacy: PGlite;
  const before: Record<string, number> = {};
  let studentId = "";
  let classId = "";

  beforeAll(async () => {
    legacy = await PGlite.create();
    await legacy.exec(BOOTSTRAP);
    await applyMigrations(legacy, BEFORE_EXPAND);

    const carpool = await scalar<string>(
      legacy,
      "insert into public.carpools (name) values ('Old family') returning id",
    );
    studentId = await scalar<string>(
      legacy,
      "insert into public.students (first_name, last_name, carpool_id) values ('Old', 'Student', $1) returning id",
      [carpool],
    );
    const second = await scalar<string>(
      legacy,
      "insert into public.students (first_name, last_name) values ('Other', 'Student') returning id",
    );
    classId = await scalar<string>(
      legacy,
      "select id from public.class_groups order by sort_order limit 1",
    );
    await legacy.query(
      "insert into public.student_classes (student_id, class_group_id) values ($1, $3), ($2, $3)",
      [studentId, second, classId],
    );
    await legacy.query(
      "insert into public.student_parents (student_id, parent1_name) values ($1, 'P')",
      [studentId],
    );
    await legacy.query(
      "insert into public.status_events (student_id, carpool_id, changed_to, source) values ($1, $2, 'arrived', 'voice'), (null, null, 'waiting', 'admin')",
      [studentId, carpool],
    );
    for (const t of DATA_TABLES) {
      before[t] = Number(
        await scalar<string | number>(
          legacy,
          `select count(*) from public.${t}`,
        ),
      );
    }
    await legacy.exec(readFileSync(join(MIGRATIONS_DIR, EXPAND), "utf8"));
  }, 60_000);

  afterAll(async () => {
    await legacy?.close();
  });

  it("creates school #1 with the agreed settings", async () => {
    const [school] = await rows<{
      id: string;
      name: string;
      slug: string;
      timezone: string;
      reset_hour: number;
      reset_days: number[];
      voice_enabled: boolean;
      voice_monthly_limit: number | null;
    }>(legacy, "select * from public.schools");
    expect(school.id).toBe(SCHOOL_1);
    expect(school.name).toBe("My School");
    expect(school.slug).toBe("my-school");
    expect(school.timezone).toBe("America/Los_Angeles");
    expect(school.reset_hour).toBe(20);
    expect(school.reset_days).toEqual([0, 1, 2, 3, 4]);
    expect(school.voice_enabled).toBe(true);
    expect(school.voice_monthly_limit).toBeNull();
    const [secret] = await rows<{
      announce_code: string | null;
      display_code: string | null;
    }>(legacy, "select * from public.school_secrets");
    expect(secret.announce_code).toBeNull();
    expect(secret.display_code).toBeNull();
  });

  it.each(DATA_TABLES)(
    "gives every %s row school #1's id and loses none",
    async (t) => {
      expect(await countBySchool(legacy, t, SCHOOL_1)).toBe(before[t]);
      expect(
        Number(
          await scalar<string | number>(
            legacy,
            `select count(*) from public.${t}`,
          ),
        ),
      ).toBe(before[t]);
    },
  );

  it("keeps the old RPC signatures working and scoped to school #1", async () => {
    const other = await scalar<string>(
      legacy,
      "select id from public.class_groups where id <> $1 order by sort_order limit 1",
      [classId],
    );
    await legacy.query("select public.set_student_classes($1, $2)", [
      studentId,
      [other],
    ]);
    const links = await rows<{ school_id: string; class_group_id: string }>(
      legacy,
      "select school_id, class_group_id from public.student_classes where student_id = $1",
      [studentId],
    );
    expect(links).toEqual([{ school_id: SCHOOL_1, class_group_id: other }]);

    const changed = await scalar<{ member_count: number }>(
      legacy,
      "select public.change_class_members($1, $2, '{}')",
      [classId, [studentId]],
    );
    expect(changed.member_count).toBe(2);

    const removed = await scalar<{ deleted: boolean }>(
      legacy,
      "select public.remove_class_group($1, $2, false)",
      [classId, other],
    );
    expect(removed.deleted).toBe(true);
    // One-argument call keeps its default arguments.
    const removedAgain = await scalar<{ deleted: boolean }>(
      legacy,
      "select public.remove_class_group($1)",
      [other],
    ).catch(() => null);
    expect(removedAgain === null || removedAgain.deleted !== undefined).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------

describe("schema shape", () => {
  // PostgREST embeds a relationship as a single object only when the foreign
  // key columns are exactly a primary or unique key. The deployed functions
  // throw if `student_parents` ever comes back as an array, so widening its
  // foreign key to (school_id, student_id) needs a unique key of that shape.
  it("keeps student_parents one-to-one: its foreign key columns are exactly a unique key", async () => {
    const oneToOne = await scalar<boolean>(
      db,
      `select exists (
         select 1
           from pg_constraint fk
           join pg_constraint uq
             on uq.conrelid = fk.conrelid
            and uq.contype in ('p', 'u')
            and (select array_agg(k order by k) from unnest(uq.conkey) k)
              = (select array_agg(k order by k) from unnest(fk.conkey) k)
          where fk.contype = 'f'
            and fk.conrelid = 'public.student_parents'::regclass
            and fk.confrelid = 'public.students'::regclass
       )`,
    );
    expect(oneToOne).toBe(true);
  });

  it("replaced each single-column foreign key in one go, leaving exactly one relationship per table pair", async () => {
    const fks = await rows<{ child: string; parent: string; n: number }>(
      db,
      `select c.conrelid::regclass::text as child,
              c.confrelid::regclass::text as parent,
              count(*)::int as n
         from pg_constraint c
        where c.contype = 'f'
          and c.connamespace = 'public'::regnamespace
          and c.confrelid::regclass::text in
              ('students', 'class_groups', 'carpools')
        group by 1, 2`,
    );
    for (const fk of fks) {
      expect(fk.n, `${fk.child} -> ${fk.parent}`).toBe(1);
    }
    expect(fks.map((f) => `${f.child}>${f.parent}`).sort()).toEqual(
      [
        "student_classes>class_groups",
        "student_classes>students",
        "student_parents>students",
        "status_events>carpools",
        "status_events>students",
        "students>carpools",
      ].sort(),
    );
    // Every one of them is composite (school_id first).
    const widths = await rows<{ n: number }>(
      db,
      `select cardinality(conkey) as n from pg_constraint
        where contype = 'f' and connamespace = 'public'::regnamespace
          and confrelid::regclass::text in ('students','class_groups','carpools')`,
    );
    expect(widths.every((w) => w.n === 2)).toBe(true);
  });

  it("keeps the unique index names application code may match on", async () => {
    const names = await rows<{ indexname: string; indexdef: string }>(
      db,
      "select indexname, indexdef from pg_indexes where schemaname = 'public' and indexname in ('carpools_name_key', 'class_groups_name_key')",
    );
    expect(names).toHaveLength(2);
    for (const n of names) {
      expect(n.indexdef).toMatch(/\(school_id, lower\(name\)\)/);
    }
  });

  it("has RLS on every new table", async () => {
    const res = await rows<{ relname: string; relrowsecurity: boolean }>(
      db,
      "select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname in ('schools','school_secrets','school_members','school_devices','school_usage')",
    );
    expect(res).toHaveLength(5);
    expect(res.every((r) => r.relrowsecurity)).toBe(true);
  });

  it("rejects malformed school rows", async () => {
    const bad = [
      "insert into public.schools (name, slug) values ('   ', 'ok-slug')",
      "insert into public.schools (name, slug) values ('N', 'Bad Slug')",
      "insert into public.schools (name, slug) values ('N', 'a')",
      "insert into public.schools (name, slug, reset_hour) values ('N', 'hour-bad', 24)",
      "insert into public.schools (name, slug, voice_monthly_limit) values ('N', 'limit-bad', -1)",
      "insert into public.schools (name, slug) values ('N', 'my-school')",
    ];
    for (const sql of bad) {
      expect(await errorOf(db, sql), sql).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------

describe("composite foreign keys reject a cross-school link", () => {
  const cases: [
    string,
    string,
    (x: SeededSchool, y: SeededSchool) => unknown[],
  ][] = [
    [
      "students -> carpools",
      "insert into public.students (school_id, first_name, last_name, carpool_id) values ($1, 'X', 'Y', $2)",
      (a, b) => [a.schoolId, b.carpoolId],
    ],
    [
      "status_events -> students",
      "insert into public.status_events (school_id, student_id, changed_to, source) values ($1, $2, 'arrived', 'voice')",
      (a, b) => [a.schoolId, b.studentId],
    ],
    [
      "status_events -> carpools",
      "insert into public.status_events (school_id, carpool_id, changed_to, source) values ($1, $2, 'arrived', 'voice')",
      (a, b) => [a.schoolId, b.carpoolId],
    ],
    [
      "student_parents -> students",
      "insert into public.student_parents (school_id, student_id) values ($1, $2)",
      (a, b) => [a.schoolId, b.siblingId],
    ],
    [
      "student_classes -> students",
      "insert into public.student_classes (school_id, student_id, class_group_id) values ($1, $2, $3)",
      (a, b) => [a.schoolId, b.siblingId, a.classId],
    ],
    [
      "student_classes -> class_groups",
      "insert into public.student_classes (school_id, student_id, class_group_id) values ($1, $2, $3)",
      (a, b) => [a.schoolId, a.siblingId, b.classId],
    ],
  ];

  it.each(cases)("%s", async (_label, sql, params) => {
    expect((await errorOf(db, sql, params(A, B)))?.code).toBe("23503");
    expect((await errorOf(db, sql, params(B, A)))?.code).toBe("23503");
  });

  it("also rejects moving an existing row into the other school's carpool", async () => {
    expect(
      (
        await errorOf(
          db,
          "update public.students set carpool_id = $1 where id = $2",
          [B.carpoolId, A.siblingId],
        )
      )?.code,
    ).toBe("23503");
  });

  it("still allows same-school links", async () => {
    expect(
      await errorOf(
        db,
        "update public.students set carpool_id = $1 where id = $2",
        [A.carpoolId, A.siblingId],
      ),
    ).toBeNull();
  });
});

describe("deletes keep today's behaviour", () => {
  it("nulls status_events.student_id but keeps school_id when a student is deleted; removes its links and parent row", async () => {
    const S = await seedSchool(db, "Del1");
    await db.query("delete from public.students where id = $1", [S.studentId]);
    const events = await rows<{ student_id: string | null; school_id: string }>(
      db,
      "select student_id, school_id from public.status_events where school_id = $1",
      [S.schoolId],
    );
    expect(events).toHaveLength(2);
    for (const e of events) {
      expect(e.student_id).toBeNull();
      expect(e.school_id).toBe(S.schoolId);
    }
    expect(await countBySchool(db, "student_classes", S.schoolId)).toBe(0);
    expect(await countBySchool(db, "student_parents", S.schoolId)).toBe(0);
    expect(await countBySchool(db, "students", S.schoolId)).toBe(1);
  });

  it("nulls carpool_id on students and status_events but keeps both school_ids when a carpool is deleted", async () => {
    const S = await seedSchool(db, "Del2");
    await db.query("delete from public.carpools where id = $1", [S.carpoolId]);
    const students = await rows<{
      carpool_id: string | null;
      school_id: string;
    }>(
      db,
      "select carpool_id, school_id from public.students where school_id = $1",
      [S.schoolId],
    );
    expect(students).toHaveLength(2);
    expect(students.every((s) => s.carpool_id === null)).toBe(true);
    expect(students.every((s) => s.school_id === S.schoolId)).toBe(true);
    const events = await rows<{ carpool_id: string | null; school_id: string }>(
      db,
      "select carpool_id, school_id from public.status_events where school_id = $1",
      [S.schoolId],
    );
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.carpool_id === null)).toBe(true);
    expect(events.every((e) => e.school_id === S.schoolId)).toBe(true);
  });

  it("deleting a school removes all of its data and leaves another school untouched", async () => {
    const S = await seedSchool(db, "Del3");
    const userId = await insertAuthUser(db, { email: "del3@example.com" });
    await db.query(
      "insert into public.school_members (school_id, user_id, role) values ($1, $2, 'owner')",
      [S.schoolId, userId],
    );
    await db.query(
      "insert into public.school_secrets (school_id) values ($1)",
      [S.schoolId],
    );
    await db.query(
      "insert into public.school_usage (school_id, month, voice_sessions) values ($1, '2026-11-01', 3)",
      [S.schoolId],
    );
    const devUser = await insertAuthUser(db, { anonymous: true });
    await db.query(
      "insert into public.school_devices (school_id, user_id) values ($1, $2)",
      [S.schoolId, devUser],
    );
    const beforeB = await Promise.all(
      DATA_TABLES.map((t) => countBySchool(db, t, B.schoolId)),
    );

    await db.query("delete from public.schools where id = $1", [S.schoolId]);

    for (const t of [
      ...DATA_TABLES,
      "school_members",
      "school_secrets",
      "school_devices",
      "school_usage",
    ]) {
      expect(await countBySchool(db, t, S.schoolId), t).toBe(0);
    }
    const afterB = await Promise.all(
      DATA_TABLES.map((t) => countBySchool(db, t, B.schoolId)),
    );
    expect(afterB).toEqual(beforeB);
    expect(beforeB.every((n) => n > 0)).toBe(true);
  });
});

describe("names are unique per school, not globally", () => {
  it("allows the same class and carpool name in two schools", async () => {
    // A and B were both seeded with 'Seed Class' / 'Cohen family'.
    expect(
      await scalar<string | number>(
        db,
        "select count(*) from public.class_groups where name = 'Seed Class'",
      ),
    ).toBeGreaterThanOrEqual(2);
    expect(
      await scalar<string | number>(
        db,
        "select count(*) from public.carpools where name = 'Cohen family'",
      ),
    ).toBeGreaterThanOrEqual(2);
  });

  it("rejects the same name twice within one school, case-insensitively (23505)", async () => {
    expect(
      (
        await errorOf(
          db,
          "insert into public.class_groups (school_id, name, sort_order) values ($1, 'seed class', 101)",
          [A.schoolId],
        )
      )?.code,
    ).toBe("23505");
    expect(
      (
        await errorOf(
          db,
          "insert into public.carpools (school_id, name) values ($1, 'COHEN FAMILY')",
          [A.schoolId],
        )
      )?.code,
    ).toBe("23505");
  });

  it("still rejects a duplicate that omits school_id (old code lands in school #1)", async () => {
    expect(
      (
        await errorOf(
          db,
          "insert into public.class_groups (name, sort_order) values ('K1', 200)",
        )
      )?.code,
    ).toBe("23505");
  });
});

// ---------------------------------------------------------------------------

describe("row-level security", () => {
  let memberA: string;
  let memberA2: string;
  let deviceB: string;
  let stranger: string;

  beforeAll(async () => {
    memberA = await insertAuthUser(db, { email: "a-owner@example.com" });
    memberA2 = await insertAuthUser(db, { email: "a-admin@example.com" });
    stranger = await insertAuthUser(db, { email: "nobody@example.com" });
    deviceB = await insertAuthUser(db, { anonymous: true });
    await db.query(
      "insert into public.school_members (school_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'admin')",
      [A.schoolId, memberA, memberA2],
    );
    await db.query(
      "insert into public.school_devices (school_id, user_id, can_announce) values ($1, $2, true)",
      [B.schoolId, deviceB],
    );
    await db.query(
      "insert into public.school_secrets (school_id, announce_code) values ($1, '1234') on conflict do nothing",
      [A.schoolId],
    );
    await db.query(
      "insert into public.school_usage (school_id, month) values ($1, '2026-11-01')",
      [A.schoolId],
    );
  });

  const SCOPED = ["students", "class_groups", "student_classes"] as const;

  it("shows a member of A only A's rows and only A's school", async () => {
    await asUserOn(db, memberA, async () => {
      for (const t of SCOPED) {
        expect(await visibleSchools(db, t), t).toEqual([A.schoolId]);
      }
      expect(await visibleSchools(db, "schools", "id")).toEqual([A.schoolId]);
      // Same names exist in B, so a leak would show up as extra rows.
      const maya = await rows<{ school_id: string }>(
        db,
        "select school_id from public.students where last_name = 'Cohen'",
      );
      expect(maya).toHaveLength(2);
    });
  });

  it("shows a device of B only B", async () => {
    await asUserOn(
      db,
      deviceB,
      async () => {
        for (const t of SCOPED) {
          expect(await visibleSchools(db, t), t).toEqual([B.schoolId]);
        }
        expect(await visibleSchools(db, "schools", "id")).toEqual([B.schoolId]);
      },
      { anonymous: true },
    );
  });

  it("shows a signed-in user with no membership nothing", async () => {
    await asUserOn(db, stranger, async () => {
      for (const t of SCOPED) {
        expect(await rows(db, `select 1 from public.${t}`), t).toHaveLength(0);
      }
      expect(await rows(db, "select 1 from public.schools")).toHaveLength(0);
    });
  });

  it("shows anon only school #1's roster rows and nothing from schools", async () => {
    await asRoleOn(db, "anon", async () => {
      for (const t of SCOPED) {
        const seen = await visibleSchools(db, t);
        expect(seen, t).toEqual([SCHOOL_1]);
      }
      expect(await rows(db, "select 1 from public.students")).not.toHaveLength(
        0,
      );
      expect(await errorOf(db, "select * from public.schools")).not.toBeNull();
    });
  });

  it("lets a caller see only its own school_members and school_devices row", async () => {
    await asUserOn(db, memberA, async () => {
      const mine = await rows<{ user_id: string }>(
        db,
        "select user_id from public.school_members",
      );
      expect(mine.map((m) => m.user_id)).toEqual([memberA]);
      expect(
        await rows(db, "select 1 from public.school_devices"),
      ).toHaveLength(0);
    });
    await asUserOn(db, memberA2, async () => {
      const mine = await rows<{ user_id: string }>(
        db,
        "select user_id from public.school_members",
      );
      expect(mine.map((m) => m.user_id)).toEqual([memberA2]);
    });
    await asUserOn(
      db,
      deviceB,
      async () => {
        const mine = await rows<{ user_id: string }>(
          db,
          "select user_id from public.school_devices",
        );
        expect(mine.map((m) => m.user_id)).toEqual([deviceB]);
        expect(
          await rows(db, "select 1 from public.school_members"),
        ).toHaveLength(0);
      },
      { anonymous: true },
    );
  });

  it("makes school_secrets and school_usage unreadable to anon and authenticated", async () => {
    for (const t of ["school_secrets", "school_usage"]) {
      expect(
        await asRoleOn(db, "anon", () =>
          errorOf(db, `select * from public.${t}`),
        ),
        `anon ${t}`,
      ).not.toBeNull();
      await asUserOn(db, memberA, async () => {
        expect(
          await errorOf(db, `select * from public.${t}`),
          `member ${t}`,
        ).not.toBeNull();
      });
    }
  });

  it("gives a caller who is a member of one school and a device of another exactly those two", async () => {
    const both = await insertAuthUser(db, { email: "both@example.com" });
    await db.query(
      "insert into public.school_members (school_id, user_id, role) values ($1, $2, 'admin')",
      [A.schoolId, both],
    );
    await db.query(
      "insert into public.school_devices (school_id, user_id, can_display) values ($1, $2, true)",
      [B.schoolId, both],
    );
    const seen = await asUserOn(db, both, () =>
      rows<{ id: string }>(db, "select id from public.schools"),
    );
    expect(seen.map((r) => r.id).sort()).toEqual(
      [A.schoolId, B.schoolId].sort(),
    );
    const students = await asUserOn(db, both, () =>
      rows<{ school_id: string }>(
        db,
        "select distinct school_id from public.students",
      ),
    );
    expect(students.map((r) => r.school_id).sort()).toEqual(
      [A.schoolId, B.schoolId].sort(),
    );
  });

  const WRITES = [
    "students",
    "class_groups",
    "carpools",
    "status_events",
    "student_parents",
    "student_classes",
    "schools",
    "school_members",
    "school_devices",
    "school_secrets",
    "school_usage",
  ];

  it.each(WRITES)(
    "denies anon and authenticated any write on %s",
    async (t) => {
      const stmts = [
        `insert into public.${t} select * from public.${t} limit 0`,
        `update public.${t} set school_id = school_id`.replace(
          "school_id = school_id",
          t === "schools" ? "name = name" : "school_id = school_id",
        ),
        `delete from public.${t}`,
      ];
      for (const sql of stmts) {
        expect(
          await asRoleOn(db, "anon", () => errorOf(db, sql)),
          `anon ${sql}`,
        ).not.toBeNull();
        await asUserOn(db, memberA, async () => {
          expect(await errorOf(db, sql), `member ${sql}`).not.toBeNull();
        });
      }
    },
  );

  it("has no write policy on any table", async () => {
    const res = await rows<{ cmd: string }>(
      db,
      "select cmd from pg_policies where schemaname = 'public'",
    );
    expect(res.every((p) => p.cmd === "SELECT")).toBe(true);
  });

  it("replaced the open select policies with a legacy anon one and a scoped authenticated one per table", async () => {
    for (const t of SCOPED) {
      const pol = await rows<{ roles: string; qual: string }>(
        db,
        "select roles::text as roles, qual from pg_policies where schemaname = 'public' and tablename = $1 order by roles::text",
        [t],
      );
      expect(pol, t).toHaveLength(2);
      expect(
        pol.some((p) => p.roles === "{anon}"),
        t,
      ).toBe(true);
      expect(
        pol.some((p) => p.roles === "{authenticated}"),
        t,
      ).toBe(true);
      expect(
        pol.some((p) => p.qual === "true"),
        t,
      ).toBe(false);
    }
  });

  it("current_school_ids() is not executable by anon, is by authenticated, and unions members and devices", async () => {
    expect(
      await scalar<boolean>(
        db,
        "select has_function_privilege('anon', 'private.current_school_ids()', 'execute')",
      ),
    ).toBe(false);
    expect(
      await scalar<boolean>(
        db,
        "select has_function_privilege('authenticated', 'private.current_school_ids()', 'execute')",
      ),
    ).toBe(true);
    expect(
      await asRoleOn(db, "anon", () =>
        errorOf(db, "select * from private.current_school_ids()"),
      ),
    ).not.toBeNull();
    await asUserOn(db, memberA, async () => {
      const ids = await rows<{ current_school_ids: string }>(
        db,
        "select * from private.current_school_ids()",
      );
      expect(ids.map((r) => r.current_school_ids)).toEqual([A.schoolId]);
    });
    await asUserOn(
      db,
      deviceB,
      async () => {
        const ids = await rows<{ current_school_ids: string }>(
          db,
          "select * from private.current_school_ids()",
        );
        expect(ids.map((r) => r.current_school_ids)).toEqual([B.schoolId]);
      },
      { anonymous: true },
    );
  });
});

// ---------------------------------------------------------------------------

describe("school-scoped RPC overloads", () => {
  const NEW_SIGS = [
    "public.set_student_classes(uuid, uuid, uuid[])",
    "public.change_class_members(uuid, uuid, uuid[], uuid[])",
    "public.remove_class_group(uuid, uuid, uuid, boolean)",
  ];
  const OLD_SIGS = [
    "public.set_student_classes(uuid, uuid[])",
    "public.change_class_members(uuid, uuid[], uuid[])",
    "public.remove_class_group(uuid, uuid, boolean)",
  ];
  const UNKNOWN = "11111111-1111-4111-8111-111111111111";

  /** Strips the specific uuid so two errors can be compared for shape. */
  function shape(e: SqlError | null): string {
    expect(e).not.toBeNull();
    return `${e?.code}:${(e?.message ?? "").replace(/[0-9a-f-]{36}/g, "<id>")}`;
  }

  it.each([...NEW_SIGS, ...OLD_SIGS])(
    "%s is executable by service_role only",
    async (sig) => {
      for (const role of ["anon", "authenticated"]) {
        expect(
          await scalar<boolean>(
            db,
            `select has_function_privilege('${role}', '${sig}', 'execute')`,
          ),
          `${role} ${sig}`,
        ).toBe(false);
      }
      expect(
        await scalar<boolean>(
          db,
          `select has_function_privilege('service_role', '${sig}', 'execute')`,
        ),
      ).toBe(true);
    },
  );

  it("set_student_classes treats a foreign student like an unknown one", async () => {
    const foreign = await errorOf(
      db,
      "select public.set_student_classes($1, $2, $3)",
      [A.schoolId, B.studentId, [A.classId]],
    );
    const unknown = await errorOf(
      db,
      "select public.set_student_classes($1, $2, $3)",
      [A.schoolId, UNKNOWN, [A.classId]],
    );
    expect(foreign?.code).toBe("P0002");
    expect(shape(foreign)).toBe(shape(unknown));
  });

  it("set_student_classes treats a foreign class like an unknown one and changes nothing", async () => {
    const foreign = await errorOf(
      db,
      "select public.set_student_classes($1, $2, $3)",
      [A.schoolId, A.studentId, [B.classId]],
    );
    const unknown = await errorOf(
      db,
      "select public.set_student_classes($1, $2, $3)",
      [A.schoolId, A.studentId, [UNKNOWN]],
    );
    expect(foreign?.code).toBe("23503");
    expect(foreign?.code).toBe(unknown?.code);
    const links = await rows<{ class_group_id: string }>(
      db,
      "select class_group_id from public.student_classes where student_id = $1",
      [A.studentId],
    );
    expect(links.map((l) => l.class_group_id)).toEqual([A.classId]);
  });

  it("set_student_classes replaces a student's set inside its own school", async () => {
    const extra = await scalar<string>(
      db,
      "insert into public.class_groups (school_id, name, sort_order) values ($1, 'Extra', 101) returning id",
      [A.schoolId],
    );
    await db.query("select public.set_student_classes($1, $2, $3)", [
      A.schoolId,
      A.siblingId,
      [extra, extra],
    ]);
    const links = await rows<{ school_id: string; class_group_id: string }>(
      db,
      "select school_id, class_group_id from public.student_classes where student_id = $1",
      [A.siblingId],
    );
    expect(links).toEqual([{ school_id: A.schoolId, class_group_id: extra }]);
    await db.query("select public.set_student_classes($1, $2, '{}')", [
      A.schoolId,
      A.siblingId,
    ]);
    expect(await countBySchool(db, "student_classes", B.schoolId)).toBe(1);
  });

  it("change_class_members reports a foreign student in ignored_ids and links nothing", async () => {
    const before = await countBySchool(db, "student_classes", A.schoolId);
    const res = await scalar<{ member_count: number; ignored_ids: string[] }>(
      db,
      "select public.change_class_members($1, $2, $3, $4)",
      [A.schoolId, A.classId, [B.studentId, B.siblingId], [B.studentId]],
    );
    expect(res.ignored_ids.sort()).toEqual([B.studentId, B.siblingId].sort());
    expect(await countBySchool(db, "student_classes", A.schoolId)).toBe(before);
    expect(
      await scalar<string | number>(
        db,
        "select count(*) from public.student_classes where student_id in ($1, $2) and school_id = $3",
        [B.studentId, B.siblingId, A.schoolId],
      ),
    ).toEqual(0);
    // B's own link is untouched by the foreign remove request.
    expect(await countBySchool(db, "student_classes", B.schoolId)).toBe(1);
  });

  it("change_class_members treats a foreign class like an unknown one and adds in-school students", async () => {
    const foreign = await errorOf(
      db,
      "select public.change_class_members($1, $2, '{}', '{}')",
      [A.schoolId, B.classId],
    );
    const unknown = await errorOf(
      db,
      "select public.change_class_members($1, $2, '{}', '{}')",
      [A.schoolId, UNKNOWN],
    );
    expect(foreign?.code).toBe("P0002");
    expect(shape(foreign)).toBe(shape(unknown));

    const res = await scalar<{ member_count: number; ignored_ids: string[] }>(
      db,
      "select public.change_class_members($1, $2, $3, '{}')",
      [A.schoolId, A.classId, [A.siblingId]],
    );
    expect(res.member_count).toBe(2);
    expect(res.ignored_ids).toEqual([]);
    const link = await rows<{ school_id: string }>(
      db,
      "select school_id from public.student_classes where student_id = $1 and class_group_id = $2",
      [A.siblingId, A.classId],
    );
    expect(link).toEqual([{ school_id: A.schoolId }]);
  });

  it("remove_class_group treats a foreign class like an unknown one", async () => {
    const foreign = await errorOf(
      db,
      "select public.remove_class_group($1, $2, null, false)",
      [A.schoolId, B.classId],
    );
    const unknown = await errorOf(
      db,
      "select public.remove_class_group($1, $2, null, false)",
      [A.schoolId, UNKNOWN],
    );
    expect(foreign?.code).toBe("P0002");
    expect(shape(foreign)).toBe(shape(unknown));
    expect(
      await scalar<string | number>(
        db,
        "select count(*) from public.class_groups where id = $1",
        [B.classId],
      ),
    ).toEqual(1);
  });

  it("remove_class_group refuses a move target in another school, like an unknown target", async () => {
    const foreign = await errorOf(
      db,
      "select public.remove_class_group($1, $2, $3, false)",
      [A.schoolId, A.classId, B.classId],
    );
    const unknown = await errorOf(
      db,
      "select public.remove_class_group($1, $2, $3, false)",
      [A.schoolId, A.classId, UNKNOWN],
    );
    expect(foreign?.code).toBe("22023");
    expect(shape(foreign)).toBe(shape(unknown));
    expect(
      await scalar<string | number>(
        db,
        "select count(*) from public.class_groups where id = $1",
        [A.classId],
      ),
    ).toEqual(1);
  });

  it("remove_class_group keeps its sole-member guard, move and force behaviour inside one school", async () => {
    const S = await seedSchool(db, "Rpc");
    const spare = await scalar<string>(
      db,
      "insert into public.class_groups (school_id, name, sort_order) values ($1, 'Spare', 101) returning id",
      [S.schoolId],
    );
    const guarded = await scalar<{
      deleted: boolean;
      sole_member_count: number;
    }>(db, "select public.remove_class_group($1, $2, null, false)", [
      S.schoolId,
      S.classId,
    ]);
    expect(guarded.deleted).toBe(false);
    expect(guarded.sole_member_count).toBe(1);

    const moved = await scalar<{ deleted: boolean; moved_count: number }>(
      db,
      "select public.remove_class_group($1, $2, $3, false)",
      [S.schoolId, S.classId, spare],
    );
    expect(moved).toEqual({ deleted: true, moved_count: 1 });
    const link = await rows<{ school_id: string; class_group_id: string }>(
      db,
      "select school_id, class_group_id from public.student_classes where student_id = $1",
      [S.studentId],
    );
    expect(link).toEqual([{ school_id: S.schoolId, class_group_id: spare }]);

    const forced = await scalar<{ deleted: boolean }>(
      db,
      "select public.remove_class_group($1, $2, null, true)",
      [S.schoolId, spare],
    );
    expect(forced.deleted).toBe(true);
  });

  it("the old signatures delegate to school #1 and cannot reach another school", async () => {
    const res = await errorOf(db, "select public.set_student_classes($1, $2)", [
      A.studentId,
      [A.classId],
    ]);
    expect(res?.code).toBe("P0002");
    const mixed = await scalar<{ ignored_ids: string[] }>(
      db,
      "select public.change_class_members($1, $2, '{}')",
      [
        await scalar<string>(
          db,
          "select id from public.class_groups where school_id = $1 limit 1",
          [SCHOOL_1],
        ),
        [A.studentId],
      ],
    );
    expect(mixed.ignored_ids).toEqual([A.studentId]);
  });

  // The deployed code calls these through PostgREST, which binds by parameter
  // NAME. A positional call resolving correctly proves nothing about that.
  it("binds named-parameter calls, as PostgREST makes them, to the old signatures", async () => {
    const student = await scalar<string>(
      db,
      "insert into public.students (first_name, last_name) values ('Named', 'Caller') returning id",
    );
    const classId = await scalar<string>(
      db,
      "insert into public.class_groups (name, sort_order) values ('Named Class', 900) returning id",
    );
    expect(
      await errorOf(
        db,
        "select public.set_student_classes(p_student_id => $1, p_class_group_ids => $2)",
        [student, [classId]],
      ),
    ).toBeNull();
    const changed = await scalar<{ member_count: number }>(
      db,
      "select public.change_class_members(p_class_group_id => $1, p_add_ids => $2, p_remove_ids => '{}')",
      [classId, [student]],
    );
    expect(changed.member_count).toBe(1);
    const removed = await scalar<{ deleted: boolean }>(
      db,
      "select public.remove_class_group(p_class_group_id => $1, p_force => true)",
      [classId],
    );
    expect(removed.deleted).toBe(true);
    const link = await rows<{ school_id: string }>(
      db,
      "select school_id from public.student_classes where student_id = $1",
      [student],
    );
    expect(link).toEqual([]);
  });
});
