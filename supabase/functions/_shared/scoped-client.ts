/**
 * The only door from the roster store to the database.
 *
 * The store uses the service-role key, which bypasses row-level security, so
 * nothing in the database stops one of its queries from crossing schools. Worse,
 * every `school_id` column has a DEFAULT of school #1 during the rollout: an
 * insert that forgot the school would not fail, it would silently file the row
 * under the wrong school.
 *
 * So the store never builds a query itself. It asks this for one, and this adds
 * the school every time: as a filter on reads, updates and deletes, and as a
 * column on everything written. The school is applied after the caller's
 * values, so a row or patch built from request data can never override it.
 *
 * Runtime-neutral on purpose. The store itself is Deno-only and cannot run under
 * Vitest; this can, against a recording stand-in for supabase-js, which is what
 * `scoped-client.test.ts` does. `store-scoping.test.ts` then checks the store
 * has no other way to reach the database.
 */

import { isUuid } from "./schools.ts";

export type Row = Record<string, unknown>;

/** The tables that carry a `school_id`. Anything else cannot be queried here. */
export type SchoolTable =
  | "students"
  | "student_parents"
  | "student_classes"
  | "status_events"
  | "carpools"
  | "class_groups";

/**
 * The three functions that take `p_school_id`. The unscoped legacy overloads
 * share these names and still exist during rollout; `rpc` always sends
 * `p_school_id`, so PostgREST can only resolve the scoped one.
 */
export type SchoolRpc =
  "set_student_classes" | "change_class_members" | "remove_class_group";

/** A query that can be narrowed by an equality filter, as supabase-js's can. */
export interface Filterable<Self> {
  eq(column: string, value: string): Self;
}

/** Just enough of a supabase-js client to scope it, and to stand in for it. */
export interface ScopableClient<Query extends Filterable<Query>> {
  from(table: string): {
    select(columns: string): Query;
    update(patch: Row): Query;
    delete(): Query;
    insert(rows: Row | Row[]): Query;
    upsert(row: Row, options: { onConflict: string }): Query;
  };
  rpc(name: string, args: Row): Query;
}

export function scopedClient<Query extends Filterable<Query>>(
  client: ScopableClient<Query>,
  schoolId: string,
) {
  // The id came from the guard, which already checked it. Checked again here
  // because this is the last place a wrong value could still be stopped.
  if (!isUuid(schoolId)) {
    throw new Error("scopedClient needs a school id.");
  }

  const stamp = (row: Row): Row => ({ ...row, school_id: schoolId });

  return {
    select: (table: SchoolTable, columns: string) =>
      client.from(table).select(columns).eq("school_id", schoolId),
    // Stamped as well as filtered: a patch must not be able to move a row.
    update: (table: SchoolTable, patch: Row) =>
      client.from(table).update(stamp(patch)).eq("school_id", schoolId),
    remove: (table: SchoolTable) =>
      client.from(table).delete().eq("school_id", schoolId),
    insert: (table: SchoolTable, rows: Row | Row[]) =>
      client
        .from(table)
        .insert(Array.isArray(rows) ? rows.map(stamp) : stamp(rows)),
    upsert: (table: SchoolTable, row: Row, onConflict: string) =>
      client.from(table).upsert(stamp(row), { onConflict }),
    rpc: (name: SchoolRpc, args: Row & { p_school_id?: never }) =>
      client.rpc(name, { ...args, p_school_id: schoolId }),
  };
}

export type ScopedClient<Query extends Filterable<Query>> = ReturnType<
  typeof scopedClient<Query>
>;
