/**
 * Loads the sample dev roster into Supabase.
 *
 *   npm run seed                  # local stack only
 *   npm run seed -- --allow-remote  # explicit opt-in for a hosted project
 *
 * This wipes `students` (and, by cascade, their class links) and
 * `status_events` before inserting, so it refuses to
 * touch anything that isn't localhost unless you say so on the command line.
 * Deleting a real school's roster because a shell had the wrong .env loaded is
 * exactly the kind of accident worth one extra flag.
 */

import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/db";
import { SAMPLE_ROSTER } from "../supabase/seed/roster";
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
  const allowRemote = process.argv.includes("--allow-remote");

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
        "    Seeding DELETES every student and status event first.\n" +
        "    If you really mean it: npm run seed -- --allow-remote",
    );
  }

  const supabase = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`\n  Seeding ${url}${isLocal(url) ? " (local)" : " (REMOTE)"}`);

  // Classes already exist (the class_groups migration seeds them, /admin
  // edits them); seeding only links students to them. Look them up first so a
  // roster naming a missing class fails before anything is wiped or inserted.
  const classRows = await supabase.from("class_groups").select("id, name");
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
    .not("id", "is", null);
  if (wipeEvents.error)
    fail(`Clearing status_events failed: ${wipeEvents.error.message}`);

  // Deleting a student cascades to their student_classes links.
  const wipeStudents = await supabase
    .from("students")
    .delete()
    .not("id", "is", null);
  if (wipeStudents.error)
    fail(`Clearing students failed: ${wipeStudents.error.message}`);

  const { data, error } = await supabase
    .from("students")
    .insert(
      SAMPLE_ROSTER.map(({ class_groups: _classes, ...student }) => ({
        ...student,
        status: "waiting" as const,
      })),
    )
    .select("id, first_name, last_name");

  if (error) fail(`Insert failed: ${error.message}`);

  const links = buildStudentClassLinks(
    attachInsertedIds(SAMPLE_ROSTER, data ?? []),
    classIdByName,
  );
  const linked = await supabase.from("student_classes").insert(links);
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
