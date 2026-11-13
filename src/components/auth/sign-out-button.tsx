"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { getOfficeBrowserClient } from "@/lib/supabase/browser";

/**
 * Ends the office session only. A paired kerb screen on this browser keeps its
 * own session under a different storage key, so it stays connected.
 */
export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      await getOfficeBrowserClient().auth.signOut();
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <Button
      variant="quiet-ink"
      onClick={signOut}
      disabled={pending}
      className="px-4"
    >
      {pending ? "Signing out" : "Sign out"}
    </Button>
  );
}
