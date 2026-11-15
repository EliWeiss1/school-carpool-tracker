"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { readLastSchool } from "@/lib/school-access";

/**
 * For a signed-out visitor opening the installed app: a phone or board that
 * was used at a school goes straight back to it; anything else gets the screen
 * picker. Rendered on the launcher in place of a server redirect because only
 * the browser knows the remembered school.
 */
export function LauncherRedirect() {
  const router = useRouter();

  useEffect(() => {
    let slug: string | null = null;
    try {
      slug = readLastSchool(window.localStorage);
    } catch {
      // Storage blocked: fall through to the picker.
    }
    router.replace(slug ? `/s/${slug}` : "/screens");
  }, [router]);

  return (
    <main className="min-h-screen bg-curb-50" aria-busy="true">
      <span className="sr-only" role="status">
        Opening CarpoolCaller
      </span>
    </main>
  );
}
