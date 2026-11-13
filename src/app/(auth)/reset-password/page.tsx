import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { getOfficeContext } from "@/lib/supabase/office";

export const metadata: Metadata = { title: "New password | CarpoolCaller" };

export default async function ResetPasswordPage() {
  const { user } = await getOfficeContext();
  // The emailed link signs the person in; without a session there is nothing
  // to attach a new password to, so start the request again.
  if (!user) redirect("/forgot-password");

  return (
    <AuthShell title="Choose a new password">
      <ResetPasswordForm />
    </AuthShell>
  );
}
