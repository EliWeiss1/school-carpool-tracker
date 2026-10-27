import { cookies } from "next/headers";

import { DisplayBoard } from "@/components/display/display-board";
import { DisplayGate } from "@/components/display/display-gate";
import {
  configuredDisplayPassword,
  cookieIsValid,
  DISPLAY_COOKIE,
} from "@/lib/display-auth";

/**
 * The wall-mounted board: status for the whole roster, updated by Supabase
 * Realtime with no reload. Read-only, behind its own password (DISPLAY_PASSWORD,
 * distinct from the staff PIN) checked on the server before the board renders.
 *
 * Stays a Server Component; all the state, effects, and the realtime socket
 * live in the client `DisplayBoard` it renders. The one thing it does itself
 * is read `?mock=1|empty` / `?flash=1` off the URL, server-side, and gate
 * them behind `NODE_ENV !== "production"` -- there is no live Supabase
 * project reachable from this development machine, so this dev-only path is
 * how the board's layout, its flash/chime, and its empty state were actually
 * built and screenshotted. Gating it here, rather than only inside the client
 * component, means a production bundle never even ships the branch that
 * would honour the query param.
 */
export default async function DisplayPage({
  searchParams,
}: {
  searchParams: { mock?: string; flash?: string; class?: string };
}) {
  const password = configuredDisplayPassword();
  const signedIn = await cookieIsValid(
    cookies().get(DISPLAY_COOKIE)?.value,
    password,
  );
  if (!signedIn) return <DisplayGate configured={password !== null} />;

  const devPreviewAllowed = process.env.NODE_ENV !== "production";
  const mockMode = devPreviewAllowed && (searchParams.mock === "1" || searchParams.mock === "empty");
  const mockEmpty = devPreviewAllowed && searchParams.mock === "empty";
  const flashPreview = devPreviewAllowed && searchParams.flash === "1";

  return (
    <DisplayBoard
      mockMode={mockMode}
      mockEmpty={mockEmpty}
      flashPreview={flashPreview}
      // Not gated behind devPreviewAllowed: unlike ?mock/?flash, this is a
      // real production feature -- a classroom tablet or a second board can
      // be bookmarked straight to one class. Read once on the server so the
      // very first client render already knows the intended class, rather
      // than flashing "all classes" for a frame first.
      initialClassParam={searchParams.class ?? null}
    />
  );
}
