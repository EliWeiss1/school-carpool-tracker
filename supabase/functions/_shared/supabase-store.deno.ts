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
  CarpoolRow,
  CarpoolWriteInput,
  RosterFilter,
  RosterStore,
  StatusEventInput,
  StudentRow,
  StudentStatus,
  StudentWriteInput,
} from "./ports.ts";

export function createSupabaseStore(env: FunctionEnv): RosterStore {
  const client = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    async list(filter: RosterFilter): Promise<StudentRow[]> {
      let query = client.from("students").select("*").order("last_name");
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
        carpool_id: event.carpoolId,
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

    async createStudent(input: StudentWriteInput): Promise<StudentRow> {
      // status/arrived_at are never in this payload: the table default and
      // the sync trigger are what put a new student in `waiting`, the same
      // path every other student took.
      const { data, error } = await client
        .from("students")
        .insert({
          first_name: input.first_name,
          last_name: input.last_name,
          aliases: input.aliases,
          class_group: input.class_group,
          carpool_id: input.carpool_id,
        })
        .select()
        .single();

      if (error)
        throw new Error(`Could not add that student: ${error.message}`);
      return data as StudentRow;
    },

    async updateStudent(
      id: string,
      patch: Partial<StudentWriteInput>,
    ): Promise<StudentRow | null> {
      const { data, error } = await client
        .from("students")
        .update(patch)
        .eq("id", id)
        .select()
        .maybeSingle();

      if (error)
        throw new Error(`Could not update that student: ${error.message}`);
      return (data as StudentRow | null) ?? null;
    },

    async setStatusMany(
      ids: string[],
      status: StudentStatus,
    ): Promise<StudentRow[]> {
      if (ids.length === 0) return [];

      // Same compare-and-set as setStatus, applied to every id at once: a
      // row already in `status` matches `neq` and is simply absent from the
      // result, whether it got there from an earlier tap or a race with this
      // very request.
      const { data, error } = await client
        .from("students")
        .update({ status })
        .in("id", ids)
        .neq("status", status)
        .select();

      if (error)
        throw new Error(`Could not update those students: ${error.message}`);
      return (data ?? []) as StudentRow[];
    },

    async removeStudent(id: string): Promise<boolean> {
      // The FK on status_events.student_id is `on delete set null`, not
      // cascade, so this delete cannot destroy that child's audit history --
      // Postgres nulls the reference for us, nothing here has to.
      const { data, error } = await client
        .from("students")
        .delete()
        .eq("id", id)
        .select("id")
        .maybeSingle();

      if (error)
        throw new Error(`Could not remove that student: ${error.message}`);
      return data !== null;
    },

    async bulkCreateStudents(
      inputs: StudentWriteInput[],
    ): Promise<StudentRow[]> {
      const { data, error } = await client
        .from("students")
        .insert(
          inputs.map((input) => ({
            first_name: input.first_name,
            last_name: input.last_name,
            aliases: input.aliases,
            class_group: input.class_group,
            carpool_id: input.carpool_id,
          })),
        )
        .select();

      if (error)
        throw new Error(`Could not import the roster: ${error.message}`);
      return (data ?? []) as StudentRow[];
    },

    async resetAllToWaiting(): Promise<StudentRow[]> {
      // `eq("status", "arrived")` is the point: an already-waiting row is
      // never part of this UPDATE, so it never appears in `data`, is never
      // handed to logEvent, and never reaches Realtime as a change at all --
      // one bulk reset cannot manufacture hundreds of no-op flashes.
      const { data, error } = await client
        .from("students")
        .update({ status: "waiting" })
        .eq("status", "arrived")
        .select();

      if (error)
        throw new Error(`Could not reset the roster: ${error.message}`);
      return (data ?? []) as StudentRow[];
    },

    async listCarpools(): Promise<CarpoolRow[]> {
      const { data, error } = await client
        .from("carpools")
        .select("*")
        .order("name");
      if (error)
        throw new Error(`Could not read the carpools: ${error.message}`);
      return (data ?? []) as CarpoolRow[];
    },

    async createCarpool(input: CarpoolWriteInput): Promise<CarpoolRow> {
      const { data, error } = await client
        .from("carpools")
        .insert({ name: input.name, aliases: input.aliases })
        .select()
        .single();

      if (error)
        throw new Error(`Could not add that carpool: ${error.message}`);
      return data as CarpoolRow;
    },

    async updateCarpool(
      id: string,
      patch: Partial<CarpoolWriteInput>,
    ): Promise<CarpoolRow | null> {
      const { data, error } = await client
        .from("carpools")
        .update(patch)
        .eq("id", id)
        .select()
        .maybeSingle();

      if (error)
        throw new Error(`Could not update that carpool: ${error.message}`);
      return (data as CarpoolRow | null) ?? null;
    },

    async removeCarpool(id: string): Promise<boolean> {
      // The FK on students.carpool_id is `on delete set null`, not cascade,
      // so this delete cannot remove a member from the roster -- Postgres
      // unlinks them for us, nothing here has to.
      const { data, error } = await client
        .from("carpools")
        .delete()
        .eq("id", id)
        .select("id")
        .maybeSingle();

      if (error)
        throw new Error(`Could not remove that carpool: ${error.message}`);
      return data !== null;
    },

    async setCarpoolMembers(
      carpoolId: string | null,
      studentIds: string[],
    ): Promise<StudentRow[]> {
      if (studentIds.length === 0) return [];

      const { data, error } = await client
        .from("students")
        .update({ carpool_id: carpoolId })
        .in("id", studentIds)
        .select();

      if (error)
        throw new Error(
          `Could not update carpool membership: ${error.message}`,
        );
      return (data ?? []) as StudentRow[];
    },
  };
}
