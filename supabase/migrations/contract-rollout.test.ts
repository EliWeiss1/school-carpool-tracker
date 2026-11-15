import { existsSync, readFileSync, readdirSync } from "node:fs";
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
 * The multi-school CONTRACT step (_rollout/contract_multi_school.sql.txt),
 * proven before the day it is needed. The snippet is never applied by the
 * migration runner; this test is the only thing that executes it. Everything
 * is seeded and checked on the un-contracted schema first, then the snippet is
 * applied, then the same isolation checks run again to prove nothing regressed.
 */

const DIR = dirname(fileURLToPath(import.meta.url));
const SNIPPET_PATH = join(DIR, "_rollout", "contract_multi_school.sql.txt");
const SCHOOL_1 = "00000000-0000-4000-8000-000000000001";

const SIX_TABLES = [
  "students",
  "class_groups",
  "carpools",
  "status_events",
  "student_parents",
  "student_classes",
] as const;

/** Tables the old public key could read, and so must now read nothing. */
const ANON_TABLES = ["students", "class_groups", "student_classes"] as const;

const NEW_SIGNATURES = {
  set_student_classes:
    "p_school_id uuid, p_student_id uuid, p_class_group_ids uuid[]",
  change_class_members:
    "p_school_id uuid, p_class_group_id uuid, p_add_ids uuid[], p_remove_ids uuid[]",
  remove_class_group:
    "p_school_id uuid, p_class_group_id uuid, p_move_to uuid, p_force boolean",
} as const;

let db: PGlite;

async function rows<T extends object>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

async function scalar<T>(sql: string, params: unknown[] = []): Promise<T> {
  const res = await db.query<Record<string, T>>(sql, params);
  return Object.values(res.rows[0])[0];
}

async function errorCode(sql: string, params: unknown[] = []) {
  try {
    await db.query(sql, params);
    return null;
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    return typeof code === "string" ? code : "unknown";
  }
}

interface Seeded {
  schoolId: string;
  studentId: string;
  classId: string;
}

let n = 0;
async function seedSchool(label: string): Promise<Seeded> {
  n += 1;
  const schoolId = await scalar<string>(
    "insert into public.schools (name, slug) values ($1, $2) returning id",
    [`School ${label}`, `contract-${label.toLowerCase()}-${n}`],
  );
  const carpoolId = await scalar<string>(
    "insert into public.carpools (school_id, name) values ($1, 'Cohen family') returning id",
    [schoolId],
  );
  const studentId = await scalar<string>(
    "insert into public.students (school_id, first_name, last_name, carpool_id) values ($1, 'Maya', 'Cohen', $2) returning id",
    [schoolId, carpoolId],
  );
  const classId = await scalar<string>(
    "insert into public.class_groups (school_id, name, sort_order) values ($1, 'Seed Class', 100) returning id",
    [schoolId],
  );
  await db.query(
    "insert into public.student_classes (school_id, student_id, class_group_id) values ($1, $2, $3)",
    [schoolId, studentId, classId],
  );
  await db.query(
    "insert into public.student_parents (school_id, student_id, parent1_name) values ($1, $2, 'Parent')",
    [schoolId, studentId],
  );
  await db.query(
    "insert into public.status_events (school_id, student_id, changed_to, source) values ($1, $2, 'arrived', 'voice')",
    [schoolId, studentId],
  );
  return { schoolId, studentId, classId };
}

let A: Seeded;
let B: Seeded;
let memberA: string;
let deviceA: string;
let legacyStudent: string;

async function visible(table: string, column = "school_id") {
  return (
    await rows<{ s: string }>(
      `select distinct ${column} as s from public.${table} order by 1`,
    )
  ).map((r) => r.s);
}

/** The read boundary for authenticated callers: identical before and after. */
async function expectScopedReads() {
  for (const [who, uid, anonymous] of [
    ["member", memberA, false],
    ["device", deviceA, true],
  ] as const) {
    await asUserOn(
      db,
      uid,
      async () => {
        for (const t of ANON_TABLES) {
          expect(await visible(t), `${who} reading ${t}`).toEqual([A.schoolId]);
        }
        expect(
          await visible("schools", "id"),
          `${who} reading schools`,
        ).toEqual([A.schoolId]);
      },
      { anonymous },
    );
  }
}

async function identityArgs(name: string): Promise<string[]> {
  return (
    await rows<{ a: string }>(
      "select pg_get_function_identity_arguments(p.oid) as a from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = $1 order by 1",
      [name],
    )
  ).map((r) => r.a);
}

async function applySnippet() {
  await db.exec(readFileSync(SNIPPET_PATH, "utf8"));
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(BOOTSTRAP);
  for (const f of readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(join(DIR, f), "utf8"));
  }
  A = await seedSchool("A");
  B = await seedSchool("B");
  // Written the old way: no school_id, so it lands in school #1.
  legacyStudent = await scalar<string>(
    "insert into public.students (first_name, last_name, status) values ('Legacy', 'Student', 'arrived') returning id",
  );
  memberA = await insertAuthUser(db, { email: "member-a@x.test" });
  await db.query(
    "insert into public.school_members (school_id, user_id, role) values ($1, $2, 'owner')",
    [A.schoolId, memberA],
  );
  deviceA = await insertAuthUser(db, { anonymous: true });
  await db.query(
    "insert into public.school_devices (school_id, user_id, can_announce, can_display) values ($1, $2, true, true)",
    [A.schoolId, deviceA],
  );
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("the snippet is not a migration", () => {
  it("lives under _rollout with a .txt extension, out of the runner's reach", () => {
    expect(existsSync(SNIPPET_PATH)).toBe(true);
    const topLevel = readdirSync(DIR).filter((f) => f.endsWith(".sql"));
    expect(topLevel.some((f) => f.includes("contract"))).toBe(false);
    expect(SNIPPET_PATH.endsWith(".sql.txt")).toBe(true);
  });
});

describe("before the contract step (the expand-era schema)", () => {
  it("still has the scaffolding the contract removes", async () => {
    for (const t of SIX_TABLES) {
      expect(
        await scalar<string | null>(
          "select column_default from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = 'school_id'",
          [t],
        ),
        `${t} default`,
      ).not.toBeNull();
    }
    expect(
      Number(
        await scalar<string | number>(
          "select count(*) from pg_policies where schemaname = 'public' and 'anon' = any(roles)",
        ),
      ),
    ).toBe(3);
    expect(await identityArgs("set_student_classes")).toHaveLength(2);
    expect(await identityArgs("nightly_reset_board")).toHaveLength(1);
  });

  it("lets the public key read school #1 only", async () => {
    await asRoleOn(db, "anon", async () => {
      expect(await visible("students")).toEqual([SCHOOL_1]);
    });
  });

  it("scopes members and devices to their own school", async () => {
    await expectScopedReads();
  });
});

describe("applying the contract snippet", () => {
  it("applies cleanly", async () => {
    await applySnippet();
  });

  it("is idempotent: a second application changes nothing and errors on nothing", async () => {
    await applySnippet();
    await applySnippet();
  });
});

describe("after the contract step", () => {
  it.each(SIX_TABLES)(
    "refuses an insert into %s that omits school_id",
    async (t) => {
      const inserts: Record<string, string> = {
        students:
          "insert into public.students (first_name, last_name) values ('No', 'School')",
        class_groups:
          "insert into public.class_groups (name, sort_order) values ('No school', 1)",
        carpools: "insert into public.carpools (name) values ('No school')",
        status_events:
          "insert into public.status_events (changed_to, source) values ('waiting', 'admin')",
        student_parents: `insert into public.student_parents (student_id, parent1_name) values ('${A.studentId}', 'P')`,
        student_classes: `insert into public.student_classes (student_id, class_group_id) values ('${A.studentId}', '${A.classId}')`,
      };
      expect(await errorCode(inserts[t])).toBe("23502");
    },
  );

  it("keeps existing rows, including the legacy one, in school #1", async () => {
    expect(
      await scalar<string>(
        "select school_id from public.students where id = $1",
        [legacyStudent],
      ),
    ).toBe(SCHOOL_1);
  });

  it.each(["students", "class_groups", "student_classes"])(
    "gives the public key nothing from %s",
    async (t) => {
      await asRoleOn(db, "anon", async () => {
        expect(await errorCode(`select * from public.${t}`)).toBe("42501");
      });
    },
  );

  it("leaves no anon policy and no anon grant on any data table", async () => {
    expect(
      Number(
        await scalar<string | number>(
          "select count(*) from pg_policies where schemaname = 'public' and 'anon' = any(roles)",
        ),
      ),
    ).toBe(0);
    for (const t of SIX_TABLES) {
      expect(
        await scalar<boolean>(
          "select has_table_privilege('anon', $1, 'select')",
          [`public.${t}`],
        ),
        t,
      ).toBe(false);
    }
  });

  it("lets the public key call no function at all", async () => {
    const callable = await rows<{ f: string }>(
      `select s.nspname || '.' || p.proname as f
         from pg_proc p join pg_namespace s on s.oid = p.pronamespace
        where s.nspname in ('public', 'private')
          and p.prorettype <> 'pg_catalog.trigger'::regtype
          and has_function_privilege('anon', p.oid, 'execute')`,
    );
    expect(callable).toEqual([]);
    await asRoleOn(db, "anon", async () => {
      expect(await errorCode("select public.run_due_board_resets()")).toBe(
        "42501",
      );
    });
  });

  it("still scopes members and devices to their own school", async () => {
    await expectScopedReads();
  });

  it("no longer has the old function signatures, and keeps the school ones", async () => {
    for (const [name, args] of Object.entries(NEW_SIGNATURES)) {
      expect(await identityArgs(name), name).toEqual([args]);
    }
    expect(await identityArgs("nightly_reset_board")).toEqual([]);
    expect(await identityArgs("reset_board_to_waiting")).toEqual([]);
  });

  it("runs the school-aware class functions", async () => {
    const extra = await scalar<string>(
      "insert into public.class_groups (school_id, name, sort_order) values ($1, 'Extra', 101) returning id",
      [A.schoolId],
    );
    await db.query("select public.set_student_classes($1, $2, $3)", [
      A.schoolId,
      A.studentId,
      [A.classId, extra],
    ]);
    expect(
      await rows<{ school_id: string }>(
        "select school_id from public.student_classes where student_id = $1",
        [A.studentId],
      ),
    ).toHaveLength(2);

    const changed = await scalar<{
      member_count: number;
      ignored_ids: string[];
    }>("select public.change_class_members($1, $2, $3, '{}')", [
      A.schoolId,
      extra,
      [A.studentId, B.studentId],
    ]);
    expect(changed.ignored_ids).toEqual([B.studentId]);

    const removed = await scalar<{ deleted: boolean }>(
      "select public.remove_class_group($1, $2, null, true)",
      [A.schoolId, extra],
    );
    expect(removed.deleted).toBe(true);
  });

  it("still resets school #1 on schedule, with the old function gone", async () => {
    // Monday 20:00 PST.
    const res = await scalar<{ schools_reset: number; students_reset: number }>(
      "select public.run_due_board_resets('2026-11-17T04:00:00Z')",
    );
    expect(res.schools_reset).toBeGreaterThanOrEqual(1);
    expect(
      await scalar<string>("select status from public.students where id = $1", [
        legacyStudent,
      ]),
    ).toBe("waiting");
  });

  it("still pairs devices, creates schools and claims voice sessions", async () => {
    const owner = await insertAuthUser(db, { email: "owner-c@x.test" });
    const created = await scalar<{
      status: string;
      school: { id: string; slug: string };
    }>(
      "select public.create_school($1, 'Contract School', 'contract-school', 'UTC')",
      [owner],
    );
    expect(created.status).toBe("created");

    await db.query(
      "select public.set_school_code($1, 'announce', 'ANN123', false)",
      [created.school.id],
    );
    const device = await insertAuthUser(db, { anonymous: true });
    const paired = await scalar<{ status: string }>(
      "select public.attempt_pairing($1, 'ANN123', $2, null, '9.9.9.9')",
      [created.school.slug, device],
    );
    expect(paired.status).toBe("paired");

    const claim = await scalar<{ allowed: boolean }>(
      "select public.claim_voice_session($1)",
      [SCHOOL_1],
    );
    expect(claim.allowed).toBe(true);
  });
});
