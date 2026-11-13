import { redirect } from "next/navigation";

import { findOwnSchool, getOfficeContext } from "@/lib/supabase/office";

/**
 * Where an installed app opens (`start_url` in manifest.ts), and the one door
 * the rest of the app sends people through: an office user goes to their
 * school (or to set one up), anyone else to the legacy screen picker until the
 * cutover.
 */
export default async function AppLauncherPage() {
  let destination = "/screens";
  try {
    const { supabase, user } = await getOfficeContext();
    if (user) {
      const school = await findOwnSchool(supabase);
      destination = school ? `/s/${school.slug}` : "/welcome";
    }
  } catch {
    // Supabase unconfigured or unreachable: the legacy picker still works.
  }
  // Outside the try: redirect() works by throwing.
  redirect(destination);
}
