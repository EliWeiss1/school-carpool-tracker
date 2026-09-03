/**
 * The RosterStore backed by Postgres, using the service-role key.
 *
 * Deno-only. This is the single place in the app that can write to the database:
 * RLS gives anon nothing but `select` on students, and the service-role key
 * exists only in this process's environment.
 */

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

import type { FunctionEnv } from "./env.deno.ts";
import type {
  RosterFilter,
  RosterStore,
  StatusEventInput,
  StudentRow,
  StudentStatus,
} from "./ports.ts";

export function createSupabaseStore(env: FunctionEnv): RosterStore {
  const client = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    async list(filter: RosterFilter): Promise<StudentRow[]> {
      let query = client.from("students").select("*").order("last_name");
      if (filter.grade) query = query.eq("grade", filter.grade);
      if (filter.classGroup) query = query.eq("class_group", filter.classGroup);

      const { data, error } = await query;
      if (error) throw new Error(`Could not read the roster: ${error.message}`);
      return (data ?? []) as StudentRow[];
    },

    async get(id: string): Promise<StudentRow | null> {
      const { data, error } = await client
        .from("students")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error)
        throw new Error(`Could not read that student: ${error.message}`);
      return (data as StudentRow | null) ?? null;
    },

    async setStatus(
      id: string,
      status: StudentStatus,
    ): Promise<StudentRow | null> {
      // The `neq` is the compare-and-set: Postgres matches no row when the
      // student is already in this status, so two simultaneous confirmations
      // produce exactly one change, one audit row and one flash on the display.
      // arrived_at and updated_at are left to the trigger on purpose.
      const { data, error } = await client
        .from("students")
        .update({ status })
        .eq("id", id)
        .neq("status", status)
        .select()
        .maybeSingle();

      if (error)
        throw new Error(`Could not update that student: ${error.message}`);
      return (data as StudentRow | null) ?? null;
    },

    async logEvent(event: StatusEventInput): Promise<boolean> {
      const row = {
        student_id: event.studentId,
        changed_to: event.changedTo,
        source: event.source,
        match_confidence: event.matchConfidence,
        raw_transcript: event.rawTranscript,
      };

      // A failed audit row must not undo a status change the display has
      // already shown, so this never throws. It does retry once -- this table
      // is the corpus MATCH_POLICY gets retuned from, and a hole in it is a
      // false accept nobody can review later.
      for (let attempt = 0; attempt < 2; attempt++) {
        const { error } = await client.from("status_events").insert(row);
        if (!error) return true;
        console.error(
          `status_events insert failed (try ${attempt + 1})`,
          error.message,
        );
      }

      return false;
    },
  };
}
