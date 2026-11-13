"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { PasswordField } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { validatePassword } from "@/lib/auth-fields";
import { authErrorMessage } from "@/lib/auth-errors";
import { getOfficeBrowserClient } from "@/lib/supabase/browser";

/** Rendered only with a session: the recovery link signed this person in. */
export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const problem = validatePassword(password);
    setFieldError(problem);
    if (problem) return;

    setPending(true);
    try {
      const { error } = await getOfficeBrowserClient().auth.updateUser({
        password,
      });
      if (error) {
        setFormError(authErrorMessage(error));
        setPending(false);
        return;
      }
      router.replace("/app");
      router.refresh();
    } catch (caught: unknown) {
      setFormError(authErrorMessage(caught));
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <PasswordField
        label="New password"
        name="password"
        autoComplete="new-password"
        value={password}
        onChange={setPassword}
        hint="At least 8 characters."
        error={fieldError}
        autoFocus
      />
      {formError && <ErrorBanner message={formError} />}
      <Button type="submit" fullWidth disabled={pending}>
        {pending ? "Saving password" : "Save password"}
      </Button>
    </form>
  );
}
