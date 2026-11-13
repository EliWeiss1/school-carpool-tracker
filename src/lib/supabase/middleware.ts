import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { publicEnv } from "@/lib/env";
import type { Database } from "@/types/db";

/**
 * Refreshes the office user's Auth session on the way through, so a server
 * component never reads a cookie whose access token has just expired.
 *
 * It must never be the reason a page fails: when Supabase is unconfigured or
 * unreachable the request passes through untouched and the page decides what a
 * signed-out visitor sees.
 */
export async function updateSession(
  request: NextRequest,
): Promise<NextResponse> {
  if (!publicEnv.supabaseConfigured) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  try {
    const supabase = createServerClient<Database>(
      publicEnv.supabaseUrl,
      publicEnv.supabaseAnonKey,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(toSet) {
            // Both sides: the request so this render sees the new token, the
            // response so the browser keeps it.
            for (const { name, value } of toSet) {
              request.cookies.set(name, value);
            }
            response = NextResponse.next({ request });
            for (const { name, value, options } of toSet) {
              response.cookies.set(name, value, options);
            }
          },
        },
      },
    );
    // Asking the Auth server (not just decoding the cookie) is what triggers
    // the refresh.
    await supabase.auth.getUser();
  } catch {
    return NextResponse.next({ request });
  }

  return response;
}
