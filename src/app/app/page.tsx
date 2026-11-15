import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { findOwnSchool, getOfficeContext } from "@/lib/supabase/office";

import { LauncherRedirect } from "./launcher-redirect";

export const metadata: Metadata = { robots: { index: false } };

/**
 * Where an installed app opens (`start_url` in manifest.ts), and the one door
 * the rest of the app sends people through: an office user goes to their
 * school (or to set one up); anyone else goes back to the school this device
 * last used, or to the screen picker.
 */
export default async function AppLauncherPage() {
  let destination: string | null = null;
  try {
    const { supabase, user } = await getOfficeContext();
    if (user) {
      const school = await findOwnSchool(supabase);
      destination = school ? `/s/${school.slug}` : "/welcome";
    }
  } catch {
    // Supabase unconfigured or unreachable: the client picks a destination.
  }
  // Outside the try: redirect() works by throwing.
  if (destination) redirect(destination);
  return <LauncherRedirect />;
}
