/**
 * Loads the sample dev roster into Supabase.
 *
 *   npm run seed                  # local stack only
 *   npm run seed -- --allow-remote  # explicit opt-in for a hosted project
 *
 * This wipes `students` and `status_events` before inserting, so it refuses to
 * touch anything that isn't localhost unless you say so on the command line.
 * Deleting a real school's roster because a shell had the wrong .env loaded is
 * exactly the kind of accident worth one extra flag.
 */

import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/db";
import { SAMPLE_ROSTER } from "../supabase/seed/roster";

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

  // status_events first: its student_id FK is ON DELETE SET NULL, so orphan
  // audit rows would otherwise survive the wipe and confuse the next run.
  const wipeEvents = await supabase
    .from("status_events")
    .delete()
    .not("id", "is", null);
  if (wipeEvents.error)
    fail(`Clearing status_events failed: ${wipeEvents.error.message}`);

  const wipeStudents = await supabase
    .from("students")
    .delete()
    .not("id", "is", null);
  if (wipeStudents.error)
    fail(`Clearing students failed: ${wipeStudents.error.message}`);

  const { data, error } = await supabase
    .from("students")
    .insert(SAMPLE_ROSTER.map((s) => ({ ...s, status: "waiting" as const })))
    .select("id, class_group");

  if (error) fail(`Insert failed: ${error.message}`);

  const byClass = new Map<string, number>();
  for (const row of data ?? []) {
    const classGroup = row.class_group ?? "—";
    byClass.set(classGroup, (byClass.get(classGroup) ?? 0) + 1);
  }

  console.log(`  ✓ Inserted ${data?.length ?? 0} students, all waiting`);
  for (const classGroup of [...byClass.keys()].sort()) {
    console.log(`      class ${classGroup}: ${byClass.get(classGroup)}`);
  }
  console.log("");
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
