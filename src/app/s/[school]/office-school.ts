import "server-only";

import type { SchoolSummary } from "@/lib/screen-access";
import { getOfficeContext } from "@/lib/supabase/office";

/**
 * The school at `slug` if the signed-in account is one of its office users,
 * else null. RLS only returns schools the account belongs to, so for a device,
 * a signed-out visitor or another school's office the answer is the same null:
 * the page never reveals whether the school exists.
 */
export async function findOfficeSchool(
  slug: string,
): Promise<SchoolSummary | null> {
  try {
    const { supabase, user } = await getOfficeContext();
    if (!user) return null;
    const { data } = await supabase
      .from("schools")
      .select("id, name, slug")
      .eq("slug", slug)
      .maybeSingle();
    return data;
  } catch {
    // Auth server unreachable: fall through to the device path, which has its
    // own error state, rather than a 500.
    return null;
  }
}
