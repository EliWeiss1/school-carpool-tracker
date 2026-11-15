import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/db";

/**
 * The admin-editable class list, replacing the old hardcoded `CLASS_GROUPS`
 * array. `class_groups` is publicly readable (see its migration) -- the same
 * trust tier as `students` -- so every picker fetches it directly with the
 * anon key rather than through a PIN-gated Edge Function; only adding,
 * removing or reordering a class (`admin-api.ts`'s class-list methods, via
 * the `classes-write` Edge Function) needs the staff PIN.
 */
export interface ClassGroup {
  id: string;
  name: string;
  sortOrder: number;
}

export async function fetchClassGroups(
  client: SupabaseClient<Database>,
  schoolId: string | null = null,
): Promise<ClassGroup[]> {
  // The explicit school filter is only added on a school route; RLS already
  // limits a signed-in caller to their schools, but one person can belong to
  // two and must see one school's classes at a time.
  const base = client.from("class_groups").select("id, name, sort_order");
  const { data, error } = await (
    schoolId === null ? base : base.eq("school_id", schoolId)
  ).order("sort_order");

  if (error) {
    throw new Error(`Could not load the class list: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
  }));
}
