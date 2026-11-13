import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

export function middleware(request: NextRequest) {
  return updateSession(request);
}

/**
 * Only the office-account routes. The kerb screens (`/announce`, `/display`),
 * the legacy `/admin` and `/screens`, the landing page and static assets never
 * pass through here: they do not use the office session, and a Supabase call
 * on every `/display` request would be pure cost on the wall-mounted board.
 */
export const config = {
  matcher: [
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
    "/welcome",
    "/app",
    "/auth/:path*",
    "/s/:path*",
  ],
};
