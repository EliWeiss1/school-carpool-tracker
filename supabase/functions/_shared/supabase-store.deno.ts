/**
 * The RosterStore backed by Postgres, using the service-role key.
 *
 * Deno-only. This is the single place in the app that can write to the database:
 * RLS gives anon nothing but `select` on students, and the service-role key
 * exists only in this process's environment.
 */

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

import { flattenClassNames } from "./class-embed.ts";
import {
  classNamesFor,
  classWriteFailure,
  parseChangeMembersResult,
  parseRemoveClassGroupResult,
} from "./class-rpc.ts";
import type { FunctionEnv } from "./env.deno.ts";
import type {
  CarpoolRow,
  CarpoolWriteInput,
  ChangeMembersOutcome,
  ClassGroupRow,
  ClassGroupWriteInput,
  RemoveClassGroupOutcome,
  RosterFilter,
  RosterStore,
  StatusEventInput,
  StudentRow,
  StudentStatus,
  StudentWriteInput,
} from "./ports.ts";

type Client = ReturnType<typeof createClient>;

/**
 * A students row joined with its (possibly absent) student_parents row and its
 * student_classes links. `*` also returns the legacy students.class_group
 * column while it still exists (the expand migration leaves it in place); it is
 * deliberately not declared here, and `toStudentRow` never copies it.
 */
interface StudentJoinRow {
  id: string;
  first_name: string;
  last_name: string;
  aliases: string[];
  status: StudentStatus;
  arrived_at: string | null;
  updated_at: string;
  carpool_id: string | null;
  student_parents: {
    parent1_name: string | null;
    parent2_name: string | null;
  } | null;
  /** Validated and flattened by `flattenClassNames`, not trusted as typed. */
  student_classes: unknown;
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
 *
 * The class names get the same treatment in `flattenClassNames`. Columns are
 * copied by name rather than spread, so neither the legacy `class_group`
 * column (still present today) nor any column added to `students` later leaks
 * into API output.
 */
function toStudentRow(row: StudentJoinRow): StudentRow {
  const { student_parents } = row;
  if (Array.isArray(student_parents)) {
    throw new Error(
      "student_parents embedded as an array, not a to-one object -- the schema no longer matches this code's assumption.",
    );
  }
  return {
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    aliases: row.aliases,
    class_groups: flattenClassNames(row.student_classes),
    status: row.status,
    arrived_at: row.arrived_at,
    updated_at: row.updated_at,
    carpool_id: row.carpool_id,
    parent1_name: student_parents?.parent1_name ?? null,
    parent2_name: student_parents?.parent2_name ?? null,
  };
}

/** The plain `students` columns of a row just written with `.select()`. */
type StudentColumns = Pick<
  StudentRow,
  | "id"
  | "first_name"
  | "last_name"
  | "aliases"
  | "status"
  | "arrived_at"
  | "updated_at"
  | "carpool_id"
>;

/** Same reasoning as `toStudentRow`: name the columns, never spread the row. */
function pickStudentColumns(row: StudentColumns): StudentColumns {
  return {
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    aliases: row.aliases,
    status: row.status,
    arrived_at: row.arrived_at,
    updated_at: row.updated_at,
    carpool_id: row.carpool_id,
  };
}

const STUDENT_SELECT =
  "*, student_parents(parent1_name, parent2_name), student_classes(class_groups(name, sort_order))";

/**
 * Ids per request when deleting by id list. An `in.(...)` filter
 * travels in the URL (37 bytes per uuid), and a whole-roster import can be
 * hundreds of students.
 */
const ID_CHUNK = 100;

/** PostgREST's `max_rows` (supabase/config.toml); a page of exactly this many
 *  rows may be truncated, so paging continues until a page comes back short. */
const PAGE_SIZE = 1000;

/**
 * Parent names for one student. Always an upsert rather than an
 * insert-if-present/update-if-absent branch, since the caller does
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
  client: Client,
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

/**
 * Best-effort removal of students that were inserted but whose class links
 * could not be written, so a failed create or import never leaves behind a
 * student the admin was told was not added. `student_parents` and
 * `student_classes` rows go with them (both cascade).
 *
 * Never throws: the caller is already propagating the original failure, which
 * is the one worth reporting. A failed compensation is logged, so a stray row
 * is at least visible somewhere.
 */
async function deleteStudentsQuietly(
  client: Client,
  ids: string[],
): Promise<void> {
  for (let start = 0; start < ids.length; start += ID_CHUNK) {
    const chunk = ids.slice(start, start + ID_CHUNK);
    const { error } = await client.from("students").delete().in("id", chunk);
    if (error) {
      console.error(
        `compensating delete of ${chunk.length} student(s) failed`,
        error.message,
      );
    }
  }
}

/**
 * Every class (id, name, sort_order). The list is small and admin-edited, so
 * one read is cheaper than a per-student lookup. Writers read it BEFORE they
 * write anything, so that a failed read cannot happen after a commit.
 */
async function readClassGroups(
  client: Client,
  failure: string,
): Promise<ClassGroupRow[]> {
  const { data, error } = await client
    .from("class_groups")
    .select("*")
    .order("sort_order");
  if (error) throw new Error(`${failure}: ${error.message}`);
  return (data ?? []) as ClassGroupRow[];
}

export function createSupabaseStore(env: FunctionEnv): RosterStore {
  const client = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    async list(filter: RosterFilter): Promise<StudentRow[]> {
      const { data, error } = await client
        .from("students")
        .select(STUDENT_SELECT)
        .order("last_name");
      if (error) throw new Error(`Could not read the roster: ${error.message}`);
      const rows = ((data ?? []) as unknown as StudentJoinRow[]).map(
        toStudentRow,
      );

      // The class filter is applied here rather than in the query. A
      // PostgREST `!inner` embed filter would also narrow the embedded class
      // list, so a student in 3rd and Chess, filtered to Chess, would lose
      // "3rd" -- and the filter must not change what a student is in. The
      // roster is one school (~100 rows) and is already read whole when
      // unfiltered, so this costs nothing and stays one round trip.
      const wanted = filter.classGroups;
      if (!wanted || wanted.length === 0) return rows;
      const names = new Set(wanted);
      return rows.filter((row) =>
        row.class_groups.some((name) => names.has(name)),
      );
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
      const classIds = input.class_group_ids;
      // Read first: if this fails, nothing has been written yet.
      const groups =
        classIds.length > 0
          ? await readClassGroups(client, "Could not add that student")
          : [];

      // status/arrived_at are never in this payload: the table default and
      // the sync trigger are what put a new student in `waiting`, the same
      // path every other student took. Classes are not a column any more --
      // they are links, written below.
      const { data, error } = await client
        .from("students")
        .insert({
          first_name: input.first_name,
          last_name: input.last_name,
          aliases: input.aliases,
          carpool_id: input.carpool_id,
        })
        .select()
        .single();

      if (error)
        throw new Error(`Could not add that student: ${error.message}`);

      const created = pickStudentColumns(data as StudentColumns);

      // A brand-new student has no links, so an empty set needs no call.
      if (classIds.length > 0) {
        const { error: classError } = await client.rpc("set_student_classes", {
          p_student_id: created.id,
          p_class_group_ids: classIds,
        });
        if (classError) {
          // supabase-js has no transaction across the insert above and this
          // call, so undo the insert by hand: an admin told "could not add
          // that student" must not find them on the roster.
          await deleteStudentsQuietly(client, [created.id]);
          throw classWriteFailure(classError, "Could not add that student");
        }
      }

      await upsertParentNames(
        client,
        created.id,
        input.parent1_name,
        input.parent2_name,
      );

      return {
        ...created,
        class_groups: classNamesFor(groups, classIds),
        parent1_name: input.parent1_name,
        parent2_name: input.parent2_name,
      };
    },

    async updateStudent(
      id: string,
      patch: Partial<StudentWriteInput>,
    ): Promise<StudentRow | null> {
      const { parent1_name, parent2_name, class_group_ids, ...studentPatch } =
        patch;
      const hasStudentFields = Object.keys(studentPatch).length > 0;

      // Read first: if this fails, nothing has been written yet.
      const groups =
        class_group_ids !== undefined
          ? await readClassGroups(client, "Could not update that student")
          : [];

      // An empty PATCH body (a parent-name- or class-only edit, once
      // `parent1_name`/`parent2_name`/`class_group_ids` are pulled out above)
      // is a no-op to PostgREST, which answers with no row -- indistinguishable
      // from "id not found" unless handled separately, so such an edit must
      // never reach `.update({})` at all.
      let current: StudentRow | null;
      if (!hasStudentFields) {
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

      if (class_group_ids !== undefined) {
        // Atomic on its own: a failure leaves the previous class set intact.
        // The fields above are already saved, so there is nothing to undo --
        // re-sending the same edit converges. P0002 means the student was
        // removed between the two statements: the same "not found" as above.
        const { error } = await client.rpc("set_student_classes", {
          p_student_id: id,
          p_class_group_ids: class_group_ids,
        });
        if (error) {
          if (error.code === "P0002") return null;
          throw classWriteFailure(error, "Could not update that student");
        }
        current = {
          ...current,
          class_groups: classNamesFor(groups, class_group_ids),
        };
      }

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

      // student_parents.student_id and student_classes.student_id are both
      // `on delete cascade` (see the migrations), so removing these rows here
      // also removes any parent names and class links on file -- nothing here
      // has to do that separately.
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
      if (inputs.length === 0) return [];

      // Each row gets its id assigned here, up front, rather than letting
      // Postgres generate one on insert -- a multi-row INSERT...RETURNING
      // through PostgREST is not guaranteed to come back in input order (no
      // ORDER BY is specified), so correlating parent names and class links
      // back to a caller's input by ARRAY POSITION would risk silently
      // attaching one child's data to a different child. Supplying the id
      // makes the correlation exact instead of positional. `students.id`
      // already defaults to `gen_random_uuid()`, so this changes nothing else.
      const withIds = inputs.map((input) => ({
        id: crypto.randomUUID(),
        ...input,
      }));

      // Read first: if this fails, nothing has been written yet.
      const groups = withIds.some((input) => input.class_group_ids.length > 0)
        ? await readClassGroups(client, "Could not import the roster")
        : [];

      const { data, error } = await client
        .from("students")
        .insert(
          withIds.map((input) => ({
            id: input.id,
            first_name: input.first_name,
            last_name: input.last_name,
            aliases: input.aliases,
            carpool_id: input.carpool_id,
          })),
        )
        .select();

      if (error)
        throw new Error(`Could not import the roster: ${error.message}`);

      const created = ((data ?? []) as StudentColumns[]).map(
        pickStudentColumns,
      );

      // One insert of every link. The Set drops a class repeated within one
      // student's list, which would otherwise violate the (student, class)
      // primary key and sink the whole import.
      const links = withIds.flatMap((input) =>
        [...new Set(input.class_group_ids)].map((classGroupId) => ({
          student_id: input.id,
          class_group_id: classGroupId,
        })),
      );
      if (links.length > 0) {
        const { error: linkError } = await client
          .from("student_classes")
          .insert(links);
        if (linkError) {
          // All-or-nothing, like the CSV validation report promised: if the
          // links failed (a class deleted mid-import is the realistic case),
          // take the students back out so a retry does not 409 on every row.
          await deleteStudentsQuietly(
            client,
            withIds.map((input) => input.id),
          );
          throw classWriteFailure(linkError, "Could not import the roster");
        }
      }

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
          class_groups: classNamesFor(groups, input?.class_group_ids ?? []),
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
      return readClassGroups(client, "Could not read the class list");
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

    async removeClassGroup(
      id: string,
      options: { moveToClassId?: string; force?: boolean } = {},
    ): Promise<RemoveClassGroupOutcome> {
      // The sole-member check, the optional move and the delete all happen
      // inside remove_class_group() in one transaction -- supabase-js cannot
      // do that from here. Absent options are omitted (not sent as null) so
      // the function's own defaults apply.
      const args: Record<string, unknown> = { p_class_group_id: id };
      if (options.moveToClassId !== undefined) {
        args.p_move_to = options.moveToClassId;
      }
      if (options.force !== undefined) args.p_force = options.force;

      const { data, error } = await client.rpc("remove_class_group", args);
      if (error) {
        // The only two errcodes the function raises on purpose: the class is
        // gone (P0002), or the move target is the class itself / is gone
        // (22023). Both rolled everything back.
        if (error.code === "P0002") return { status: "not-found" };
        if (error.code === "22023") return { status: "bad-target" };
        throw classWriteFailure(error, "Could not remove that class");
      }
      return parseRemoveClassGroupResult(data);
    },

    async changeClassMembers(
      classGroupId: string,
      addIds: string[],
      removeIds: string[],
    ): Promise<ChangeMembersOutcome | null> {
      const { data, error } = await client.rpc("change_class_members", {
        p_class_group_id: classGroupId,
        p_add_ids: addIds,
        p_remove_ids: removeIds,
      });
      if (error) {
        // P0002: the class does not exist. Nothing was changed.
        if (error.code === "P0002") return null;
        throw classWriteFailure(error, "Could not update that class");
      }
      return parseChangeMembersResult(data);
    },

    async countClassMembers(): Promise<Record<string, number>> {
      // PostgREST aggregates (`count()` with an implicit group by) are off on
      // Supabase by default, so tally the links here. Ordered by the primary
      // key so pages neither overlap nor skip, and paged because one response
      // is capped at max_rows -- a silent cap would under-count a big class.
      // A hosted project may cap below PAGE_SIZE, so a short page does not mean
      // the last page: keep going (advancing by what actually came back, so no
      // row is skipped) until a page is empty.
      const counts: Record<string, number> = {};
      for (let from = 0; ; ) {
        const { data, error } = await client
          .from("student_classes")
          .select("class_group_id")
          .order("student_id")
          .order("class_group_id")
          .range(from, from + PAGE_SIZE - 1);
        if (error)
          throw new Error(`Could not count the class members: ${error.message}`);

        const rows = (data ?? []) as { class_group_id: string }[];
        for (const row of rows) {
          counts[row.class_group_id] = (counts[row.class_group_id] ?? 0) + 1;
        }
        if (rows.length === 0) break;
        from += rows.length;
      }
      return counts;
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

      return readClassGroups(client, "Could not reorder the class list");
    },
  };
}
