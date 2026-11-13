import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import { getServerClient } from "@/lib/supabase/server";
import type { Database, School } from "@/types/db";

export type OfficeSchool = Pick<School, "id" | "name" | "slug">;

/**
 * The signed-in office user, verified with the Auth server (not merely decoded
 * from the cookie), plus the client that carries their session so RLS applies.
 */
export async function getOfficeContext(): Promise<{
  supabase: SupabaseClient<Database>;
  user: User | null;
}> {
  const supabase = getServerClient();
  const { data } = await supabase.auth.getUser();
  // An anonymous user is a paired kerb device, never an office account.
  const user = data.user && !data.user.is_anonymous ? data.user : null;
  return { supabase, user };
}

/**
 * The school this account belongs to, if any. RLS limits `schools` to the
 * caller's own memberships, so no filter is needed; oldest first keeps the
 * answer stable if an account ever has more than one.
 */
export async function findOwnSchool(
  supabase: SupabaseClient<Database>,
): Promise<OfficeSchool | null> {
  const { data } = await supabase
    .from("schools")
    .select("id, name, slug")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data;
}
