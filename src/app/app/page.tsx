import { redirect } from "next/navigation";

/**
 * Where an installed app opens (`start_url` in manifest.ts). It exists so the
 * home-screen icon never lands staff on the public landing page: for now it
 * goes straight to the screen picker.
 */
export default function AppLauncherPage() {
  redirect("/screens");
}
