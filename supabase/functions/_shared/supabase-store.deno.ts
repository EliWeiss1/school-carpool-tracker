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
  ClassGroupRow,
  ClassGroupWriteInput,
  RosterFilter,
  RosterStore,
  StatusEventInput,
  StudentRow,
  StudentStatus,
  StudentWriteInput,
} from "./ports.ts";

/** A students row joined with its (possibly absent) student_parents row. */
interface StudentJoinRow {
  id: string;
  first_name: string;
  last_name: string;
  aliases: string[];
  class_group: string | null;
  status: StudentStatus;
  arrived_at: string | null;
  updated_at: string;
  carpool_id: string | null;
  student_parents: {
    parent1_name: string | null;
    parent2_name: string | null;
  } | null;
}

/**
 * supabase-js returns a to-one embed as an object or null, never an array,
 * because student_parents.student_id is that row's own primary key -- but
 * that shape depends entirely on PostgREST correctly inferring a one-to-one
 * relationship. If a future migration ever gave student_parents its own
 * surrogate id, PostgREST would start returning an array here, this would
 * silently read `undefined` off it, and `?? null` would swallow that as
 * "no parent names" with no error anywhere. Throwing loudly on the
 * unexpected shape is cheap insurance against a very expensive silent
 * failure (parent-name matching quietly stops working roster-wide).
 */
function toStudentRow(row: StudentJoinRow): StudentRow {
  const { student_parents, ...rest } = row;
  if (Array.isArray(student_parents)) {
    throw new Error(
      "student_parents embedded as an array, not a to-one object -- the schema no longer matches this code's assumption.",
    );
  }
  return {
    ...rest,
    parent1_name: student_parents?.parent1_name ?? null,
    parent2_name: student_parents?.parent2_name ?? null,
  };
}

const STUDENT_SELECT =
  "*, student_parents(parent1_name, parent2_name)";

/**
 * Writes (or clears) a student's parent-names row. Always an upsert rather
 * than an insert-if-present/update-if-absent branch, since the caller does
 * not know which case applies -- `on conflict` lets Postgres decide. Always
 * writes a row, even when both names are null (a straightforward two-null
 * row rather than a special-cased absence) -- `toStudentRow`'s `?? null`
 * treats an absent row and an all-null row identically either way, so this
 * is a storage simplicity choice, not a correctness requirement.
 *
 * Never throws: a parent-name write is secondary to the student it belongs
 * to, the same reasoning `logEvent` already applies to audit rows (see its
 * own comment) -- a student committed to `students` must not become
 * impossible to retry just because this second write failed. Errors are
 * logged so a persistent failure is at least visible somewhere.
 */
async function upsertParentNames(
  client: ReturnType<typeof createClient>,
  studentId: string,
  parent1Name: string | null,
  parent2Name: string | null,
): Promise<void> {
  const { error } = await client.from("student_parents").upsert(
    {
      student_id: studentId,
      parent1_name: parent1Name,
      parent2_name: parent2Name,
    },
    { onConflict: "student_id" },
  );
  if (error) {
    console.error(
      `student_parents upsert failed for ${studentId}`,
      error.message,
    );
  }
}

export function createSupabaseStore(env: FunctionEnv): RosterStore {
  const client = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    async list(filter: RosterFilter): Promise<StudentRow[]> {
      let query = client
        .from("students")
        .select(STUDENT_SELECT)
        .order("last_name");
      if (filter.classGroup) query = query.eq("class_group", filter.classGroup);

      const { data, error } = await query;
      if (error) throw new Error(`Could not read the roster: ${error.message}`);
      return ((data ?? []) as unknown as StudentJoinRow[]).map(toStudentRow);
    },

    async get(id: string): Promise<StudentRow | null> {
      const { data, error } = await client
        .from("students")
        .select(STUDENT_SELECT)
        .eq("id", id)
        .maybeSingle();
      if (error)
        throw new Error(`Could not read that student: ${error.message}`);
      return data ? toStudentRow(data as unknown as StudentJoinRow) : null;
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
        .select(STUDENT_SELECT)
        .maybeSingle();

      if (error)
        throw new Error(`Could not update that student: ${error.message}`);
      return data ? toStudentRow(data as unknown as StudentJoinRow) : null;
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

      await upsertParentNames(
        client,
        (data as { id: string }).id,
        input.parent1_name,
        input.parent2_name,
      );

      return {
        ...(data as Omit<StudentRow, "parent1_name" | "parent2_name">),
        parent1_name: input.parent1_name,
        parent2_name: input.parent2_name,
      };
    },

    async updateStudent(
      id: string,
      patch: Partial<StudentWriteInput>,
    ): Promise<StudentRow | null> {
      const { parent1_name, parent2_name, ...studentPatch } = patch;
      const touchesParentNamesOnly = Object.keys(studentPatch).length === 0;

      // An empty PATCH body (a parent-name-only edit, once `parent1_name`/
      // `parent2_name` are pulled out above) is a no-op to PostgREST, which
      // answers with no row -- indistinguishable from "id not found" unless
      // handled separately, so a parent-name-only edit must never reach
      // `.update({})` at all.
      let current: StudentRow | null;
      if (touchesParentNamesOnly) {
        const { data, error } = await client
          .from("students")
          .select(STUDENT_SELECT)
          .eq("id", id)
          .maybeSingle();
        if (error)
          throw new Error(`Could not read that student: ${error.message}`);
        current = data ? toStudentRow(data as unknown as StudentJoinRow) : null;
      } else {
        const { data, error } = await client
          .from("students")
          .update(studentPatch)
          .eq("id", id)
          .select(STUDENT_SELECT)
          .maybeSingle();
        if (error)
          throw new Error(`Could not update that student: ${error.message}`);
        current = data ? toStudentRow(data as unknown as StudentJoinRow) : null;
      }

      if (!current) return null;
      if (parent1_name === undefined && parent2_name === undefined) {
        return current;
      }

      const nextParent1 =
        parent1_name !== undefined ? parent1_name : current.parent1_name;
      const nextParent2 =
        parent2_name !== undefined ? parent2_name : current.parent2_name;
      await upsertParentNames(client, id, nextParent1, nextParent2);

      return { ...current, parent1_name: nextParent1, parent2_name: nextParent2 };
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
        .select(STUDENT_SELECT);

      if (error)
        throw new Error(`Could not update those students: ${error.message}`);
      return ((data ?? []) as unknown as StudentJoinRow[]).map(toStudentRow);
    },

    async removeStudents(ids: string[]): Promise<string[]> {
      if (ids.length === 0) return [];

      // student_parents.student_id is `on delete cascade` (see the
      // migration), so removing these rows here also removes any parent
      // names on file -- nothing here has to do that separately.
      const { data, error } = await client
        .from("students")
        .delete()
        .in("id", ids)
        .select("id");

      if (error)
        throw new Error(`Could not remove those students: ${error.message}`);
      return ((data ?? []) as { id: string }[]).map((row) => row.id);
    },

    async bulkCreateStudents(
      inputs: StudentWriteInput[],
    ): Promise<StudentRow[]> {
      // Each row gets its id assigned here, up front, rather than letting
      // Postgres generate one on insert -- a multi-row INSERT...RETURNING
      // through PostgREST is not guaranteed to come back in input order (no
      // ORDER BY is specified), so correlating parent names back to a
      // caller's input by ARRAY POSITION would risk silently attaching one
      // child's parent name to a different child. Supplying the id makes
      // the correlation exact instead of positional. `students.id` already
      // defaults to `gen_random_uuid()`, so this changes nothing else.
      const withIds = inputs.map((input) => ({
        id: crypto.randomUUID(),
        ...input,
      }));

      const { data, error } = await client
        .from("students")
        .insert(
          withIds.map((input) => ({
            id: input.id,
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

      const created = (data ?? []) as Omit<
        StudentRow,
        "parent1_name" | "parent2_name"
      >[];

      const parentRows = withIds
        .filter(
          (input) => input.parent1_name !== null || input.parent2_name !== null,
        )
        .map((input) => ({
          student_id: input.id,
          parent1_name: input.parent1_name,
          parent2_name: input.parent2_name,
        }));

      if (parentRows.length > 0) {
        const { error: parentError } = await client
          .from("student_parents")
          .insert(parentRows);
        // Non-throwing, matching upsertParentNames: the roster import itself
        // already committed and must not become unretriable (a re-run would
        // 409 on every row as a duplicate) just because this second write
        // failed. Logged so a persistent failure is at least visible.
        if (parentError) {
          console.error(
            "student_parents bulk insert failed during import",
            parentError.message,
          );
        }
      }

      const inputById = new Map(withIds.map((input) => [input.id, input]));
      return created.map((row) => {
        const input = inputById.get(row.id);
        return {
          ...row,
          parent1_name: input?.parent1_name ?? null,
          parent2_name: input?.parent2_name ?? null,
        };
      });
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
        .select(STUDENT_SELECT);

      if (error)
        throw new Error(`Could not reset the roster: ${error.message}`);
      return ((data ?? []) as unknown as StudentJoinRow[]).map(toStudentRow);
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
        .select(STUDENT_SELECT);

      if (error)
        throw new Error(
          `Could not update carpool membership: ${error.message}`,
        );
      return ((data ?? []) as unknown as StudentJoinRow[]).map(toStudentRow);
    },

    async listClassGroups(): Promise<ClassGroupRow[]> {
      const { data, error } = await client
        .from("class_groups")
        .select("*")
        .order("sort_order");
      if (error)
        throw new Error(`Could not read the class list: ${error.message}`);
      return (data ?? []) as ClassGroupRow[];
    },

    async createClassGroup(
      input: ClassGroupWriteInput,
    ): Promise<ClassGroupRow> {
      const { data: maxRow, error: maxError } = await client
        .from("class_groups")
        .select("sort_order")
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (maxError)
        throw new Error(`Could not add that class: ${maxError.message}`);

      const nextOrder = ((maxRow as { sort_order: number } | null)?.sort_order ?? -1) + 1;

      const { data, error } = await client
        .from("class_groups")
        .insert({ name: input.name, sort_order: nextOrder })
        .select()
        .single();

      if (error)
        throw new Error(`Could not add that class: ${error.message}`);
      return data as ClassGroupRow;
    },

    async removeClassGroup(id: string): Promise<boolean> {
      // No FK from students.class_group to this table -- it's free text, on
      // purpose (see the migration comment). Removing a class here never
      // touches a student already carrying that value.
      const { data, error } = await client
        .from("class_groups")
        .delete()
        .eq("id", id)
        .select("id")
        .maybeSingle();

      if (error)
        throw new Error(`Could not remove that class: ${error.message}`);
      return data !== null;
    },

    async reorderClassGroups(orderedIds: string[]): Promise<ClassGroupRow[]> {
      // One update per id rather than a single bulk statement: supabase-js
      // has no "update N rows with N different values" primitive, and a
      // class list is at most a few dozen rows -- this is not a hot path.
      for (const [index, id] of orderedIds.entries()) {
        const { error } = await client
          .from("class_groups")
          .update({ sort_order: index })
          .eq("id", id);
        if (error)
          throw new Error(`Could not reorder the class list: ${error.message}`);
      }

      const { data, error } = await client
        .from("class_groups")
        .select("*")
        .order("sort_order");
      if (error)
        throw new Error(`Could not reorder the class list: ${error.message}`);
      return (data ?? []) as ClassGroupRow[];
    },
  };
}
