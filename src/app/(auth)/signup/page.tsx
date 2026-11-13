import type { Metadata } from "next";

import { AuthShell } from "@/components/auth/auth-shell";
import { SignUpForm } from "@/components/auth/signup-form";

export const metadata: Metadata = { title: "Create account | CarpoolCaller" };

export default function SignUpPage() {
  return (
    <AuthShell
      title="Create your school's account"
      description="One account for the office. Devices join later with a code."
    >
      <SignUpForm />
    </AuthShell>
  );
}
