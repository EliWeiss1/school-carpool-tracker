import type { Metadata } from "next";

import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { safeNext } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Sign in | CarpoolCaller" };

export default function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string | string[]; error?: string | string[] };
}) {
  return (
    <AuthShell title="Sign in">
      <LoginForm
        next={safeNext(searchParams.next)}
        linkError={searchParams.error === "link"}
      />
    </AuthShell>
  );
}
