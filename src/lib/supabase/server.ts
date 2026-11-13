import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import type { Database } from "@/types/db";

/**
 * Anon-key client for server components and route handlers, carrying the
 * office user's session from cookies. Deliberately not the service-role key:
 * nothing in the Next.js app writes to Supabase on its own authority, that is
 * the Edge Functions' job, and RLS is what limits this client to the signed-in
 * user's own school.
 *
 * Call `auth.getUser()` (which asks the Auth server) rather than trusting
 * `getSession()` for any decision: the cookie alone can be forged.
 */
export function getServerClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  const cookieStore = cookies();
  return createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(toSet) {
        try {
          for (const { name, value, options } of toSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // A Server Component cannot set cookies. That is fine: the
          // middleware refreshes the session on every office request, so the
          // browser gets the new cookie from there.
        }
      },
    },
  });
}
