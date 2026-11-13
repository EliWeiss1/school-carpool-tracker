"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { AuthLink } from "@/components/auth/auth-link";
import { Field, PasswordField } from "@/components/auth/field";
import {
  CAPTCHA_PENDING_MESSAGE,
  Turnstile,
  useCaptcha,
} from "@/components/auth/turnstile";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { type FieldErrors, validateLogin } from "@/lib/auth-fields";
import { authErrorMessage } from "@/lib/auth-errors";
import { getOfficeBrowserClient } from "@/lib/supabase/browser";

/** Shown when /auth/confirm bounced a link that was expired or already used. */
const LINK_ERROR =
  "That link has expired or was already used. Sign in, or ask for a new one.";

export function LoginForm({
  next,
  linkError,
}: {
  /** Already validated on the server by `safeNext`. */
  next: string;
  linkError: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors<"email" | "password">>({});
  const [formError, setFormError] = useState<string | null>(
    linkError ? LINK_ERROR : null,
  );
  const [pending, setPending] = useState(false);
  const captcha = useCaptcha();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const result = validateLogin({ email, password });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    if (captcha.enabled && !captcha.token) {
      setFormError(CAPTCHA_PENDING_MESSAGE);
      return;
    }

    setPending(true);
    try {
      const { error } = await getOfficeBrowserClient().auth.signInWithPassword({
        email: result.values.email,
        password: result.values.password,
        options: { ...captcha.options },
      });
      if (error) {
        setFormError(authErrorMessage(error));
        captcha.reset();
        setPending(false);
        return;
      }
      // Leave `pending` on: the button stays "Signing in" until the new page
      // replaces this one, so a second tap cannot start a second sign-in.
      router.replace(next);
      router.refresh();
    } catch (caught: unknown) {
      setFormError(authErrorMessage(caught));
      captcha.reset();
      setPending(false);
    }
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
        error={errors.email}
        autoFocus
      />
      <PasswordField
        label="Password"
        name="password"
        autoComplete="current-password"
        value={password}
        onChange={setPassword}
        error={errors.password}
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
        {pending ? "Signing in" : "Sign in"}
      </Button>

      <div className="flex flex-col items-start">
        <AuthLink href="/forgot-password">Forgot your password?</AuthLink>
        <p className="text-curb-600">
          New here?{" "}
          <AuthLink href="/signup">Create your school&apos;s account</AuthLink>
        </p>
      </div>
    </form>
  );
}
