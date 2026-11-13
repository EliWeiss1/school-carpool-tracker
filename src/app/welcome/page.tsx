import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { WelcomeForm } from "@/components/auth/welcome-form";
import { findOwnSchool, getOfficeContext } from "@/lib/supabase/office";

export const metadata: Metadata = {
  title: "Set up your school | CarpoolCaller",
};

export default async function WelcomePage() {
  const { supabase, user } = await getOfficeContext();
  if (!user) redirect("/login?next=/welcome");

  // Opening the email link twice, or coming back later, must not offer to
  // create a second school.
  const existing = await findOwnSchool(supabase);
  if (existing) redirect(`/s/${existing.slug}`);

  const metaName: unknown = user.user_metadata?.school_name;
  const defaultName = typeof metaName === "string" ? metaName : "";

  return (
    <AuthShell
      title="Set up your school"
      description="Check these details. You can change most of them later."
    >
      <WelcomeForm defaultName={defaultName} />
    </AuthShell>
  );
}
