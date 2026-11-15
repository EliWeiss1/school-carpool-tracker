/**
 * Loads the sample dev roster into Supabase.
 *
 *   npm run seed                        # local stack, the original school
 *   npm run seed -- --school oak-hill   # local stack, another school
 *   npm run seed -- --allow-remote      # explicit opt-in for a hosted project
 *
 * This wipes ONE school's `students` (and, by cascade, their class links) and
 * `status_events` before inserting. Every delete and insert below names that
 * school, so another school's roster is never touched, whatever the arguments.
 * It also refuses to
 * touch anything that isn't localhost unless you say so on the command line.
 * Deleting a real school's roster because a shell had the wrong .env loaded is
 * exactly the kind of accident worth one extra flag.
 */

import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/db";
import { SAMPLE_ROSTER } from "../supabase/seed/roster";
import { parseSeedTarget } from "../supabase/seed/seed-target";
import {
  attachInsertedIds,
  buildStudentClassLinks,
  UnknownClassError,
} from "../supabase/seed/student-class-links";

loadEnv({ path: ".env.local" });

const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
  "host.docker.internal",
]);

function isLocal(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

function fail(message: string): never {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

async function main() {
  const target = parseSeedTarget(process.argv.slice(2));
  if (!target.ok) fail(target.error);
  const { allowRemote } = target;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    fail(
      "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.\n" +
        "    For the local stack, `npx supabase start` prints both.",
    );
  }

  if (!isLocal(url) && !allowRemote) {
    fail(
      `Refusing to seed ${url} — it is not a local Supabase instance.\n` +
        "    Seeding DELETES a school's students and status events first.\n" +
        "    If you really mean it: npm run seed -- --allow-remote",
    );
  }

  const supabase = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Resolve the school before touching anything. Not found is a stop, never a
  // fallback: the fallback would be the original school's real roster.
  const schoolQuery = supabase.from("schools").select("id, name, slug");
  const schoolRow = await (
    target.school.by === "id"
      ? schoolQuery.eq("id", target.school.id)
      : schoolQuery.eq("slug", target.school.slug)
  ).maybeSingle();
  if (schoolRow.error)
    fail(`Reading schools failed: ${schoolRow.error.message}`);
  if (schoolRow.data === null) {
    fail(
      target.school.by === "slug"
        ? `No school has the web address "${target.school.slug}".`
        : "The original school does not exist here. Apply the migrations first.",
    );
  }
  const school = schoolRow.data;

  console.log(
    `\n  Seeding ${school.name} (/s/${school.slug}) on ${url}${isLocal(url) ? " (local)" : " (REMOTE)"}`,
  );

  // Classes already exist (the class_groups migration seeds them, /admin
  // edits them); seeding only links students to them. Look them up first so a
  // roster naming a missing class fails before anything is wiped or inserted.
  const classRows = await supabase
    .from("class_groups")
    .select("id, name")
    .eq("school_id", school.id);
  if (classRows.error)
    fail(`Reading class_groups failed: ${classRows.error.message}`);
  const classIdByName = new Map(
    (classRows.data ?? []).map((row) => [row.name, row.id] as const),
  );
  try {
    buildStudentClassLinks(
      SAMPLE_ROSTER.map((s) => ({
        studentId: "",
        class_groups: s.class_groups,
      })),
      classIdByName,
    );
  } catch (err) {
    if (err instanceof UnknownClassError) fail(err.message);
    throw err;
  }

  // status_events first: its student_id FK is ON DELETE SET NULL, so orphan
  // audit rows would otherwise survive the wipe and confuse the next run.
  const wipeEvents = await supabase
    .from("status_events")
    .delete()
    .eq("school_id", school.id);
  if (wipeEvents.error)
    fail(`Clearing status_events failed: ${wipeEvents.error.message}`);

  // Deleting a student cascades to their student_classes links.
  const wipeStudents = await supabase
    .from("students")
    .delete()
    .eq("school_id", school.id);
  if (wipeStudents.error)
    fail(`Clearing students failed: ${wipeStudents.error.message}`);

  const { data, error } = await supabase
    .from("students")
    .insert(
      SAMPLE_ROSTER.map(({ class_groups: _classes, ...student }) => ({
        ...student,
        // Named on every row: the column's default is the original school.
        school_id: school.id,
        status: "waiting" as const,
      })),
    )
    .select("id, first_name, last_name");

  if (error) fail(`Insert failed: ${error.message}`);

  const links = buildStudentClassLinks(
    attachInsertedIds(SAMPLE_ROSTER, data ?? []),
    classIdByName,
  );
  const linked = await supabase
    .from("student_classes")
    .insert(links.map((link) => ({ ...link, school_id: school.id })));
  if (linked.error)
    fail(`Linking students to classes failed: ${linked.error.message}`);

  // Count by membership, not by student: a student in two classes appears
  // under both, so the per-class lines sum to more than the student total.
  const byClass = new Map<string, number>();
  const nameById = new Map(
    [...classIdByName].map(([name, id]) => [id, name] as const),
  );
  for (const link of links) {
    const name = nameById.get(link.class_group_id) ?? "—";
    byClass.set(name, (byClass.get(name) ?? 0) + 1);
  }

  console.log(`  ✓ Inserted ${data?.length ?? 0} students, all waiting`);
  console.log(`  ✓ Linked ${links.length} class memberships`);
  for (const name of [...byClass.keys()].sort()) {
    console.log(`      class ${name}: ${byClass.get(name)}`);
  }
  console.log("");
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
