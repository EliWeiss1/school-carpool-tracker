"use client";

import { type FormEvent, useState } from "react";

import { AuthLink } from "@/components/auth/auth-link";
import { Field } from "@/components/auth/field";
import {
  CAPTCHA_PENDING_MESSAGE,
  Turnstile,
  useCaptcha,
} from "@/components/auth/turnstile";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { validateEmail } from "@/lib/auth-fields";
import { authErrorMessage } from "@/lib/auth-errors";
import { getOfficeBrowserClient } from "@/lib/supabase/browser";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const captcha = useCaptcha();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const problem = validateEmail(email);
    setFieldError(problem);
    if (problem) return;
    if (captcha.enabled && !captcha.token) {
      setFormError(CAPTCHA_PENDING_MESSAGE);
      return;
    }

    setPending(true);
    try {
      const { error } =
        await getOfficeBrowserClient().auth.resetPasswordForEmail(
          email.trim(),
          {
            redirectTo: `${window.location.origin}/auth/confirm?next=/reset-password`,
            ...captcha.options,
          },
        );
      if (error) {
        setFormError(authErrorMessage(error));
        captcha.reset();
        return;
      }
      setDone(true);
    } catch (caught: unknown) {
      setFormError(authErrorMessage(caught));
      captcha.reset();
    } finally {
      setPending(false);
    }
  }

  // The same sentence whether or not the address has an account: this page
  // must never be a way to find out who is registered.
  if (done) {
    return (
      <div role="status">
        <p className="font-display text-xl font-bold text-curb-900">
          Check your email
        </p>
        <p className="mt-2 text-curb-600">
          If that address has an account, we sent a link to reset the password.
        </p>
        <div className="mt-6">
          <AuthLink href="/login">Back to sign in</AuthLink>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <Field
        label="Email"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        value={email}
        onChange={setEmail}
        error={fieldError}
        autoFocus
      />

      {captcha.siteKey && (
        <Turnstile
          ref={captcha.handle}
          siteKey={captcha.siteKey}
          onToken={captcha.setToken}
        />
      )}
      {formError && <ErrorBanner message={formError} />}

      <Button type="submit" fullWidth disabled={pending}>
        {pending ? "Sending link" : "Send reset link"}
      </Button>

      <div>
        <AuthLink href="/login">Back to sign in</AuthLink>
      </div>
    </form>
  );
}
