"use client";

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
import { type FieldErrors, validateSignUp } from "@/lib/auth-fields";
import { authErrorMessage } from "@/lib/auth-errors";
import { getOfficeBrowserClient } from "@/lib/supabase/browser";

/**
 * Step one of making a school: an account. The school itself is created on
 * /welcome, after the email link proves the address is real, so the name typed
 * here only travels as user metadata to prefill that page.
 */
export function SignUpForm() {
  const [schoolName, setSchoolName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<
    FieldErrors<"schoolName" | "email" | "password">
  >({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const captcha = useCaptcha();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const result = validateSignUp({ schoolName, email, password });
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
      const { data, error } = await getOfficeBrowserClient().auth.signUp({
        email: result.values.email,
        password: result.values.password,
        options: {
          data: { school_name: result.values.schoolName },
          emailRedirectTo: `${window.location.origin}/auth/confirm?next=/welcome`,
          ...captcha.options,
        },
      });
      if (error) {
        setFormError(authErrorMessage(error));
        captcha.reset();
        return;
      }
      // A session straight away means this project does not ask for email
      // confirmation. There is no link coming, so do not tell them to wait
      // for one: carry on to setting up the school.
      if (data.session) {
        window.location.assign("/welcome");
        return;
      }
      setSentTo(result.values.email);
      // Do not keep the password in component state behind the next screen.
      setPassword("");
    } catch (caught: unknown) {
      setFormError(authErrorMessage(caught));
      captcha.reset();
    } finally {
      setPending(false);
    }
  }

  if (sentTo) {
    return (
      <div role="status">
        <p className="font-display text-xl font-bold text-curb-900">
          Check your email
        </p>
        <p className="mt-2 text-curb-600">
          We sent a link to <span className="font-semibold">{sentTo}</span>.
          Open it to finish setting up your school.
        </p>
        <p className="mt-4 text-curb-600">
          Nothing there after a few minutes? Check your spam folder.
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
        label="School name"
        name="school_name"
        value={schoolName}
        onChange={setSchoolName}
        autoComplete="organization"
        error={errors.schoolName}
        autoFocus
      />
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
      />
      <PasswordField
        label="Password"
        name="password"
        autoComplete="new-password"
        value={password}
        onChange={setPassword}
        hint="At least 8 characters."
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
        {pending ? "Creating account" : "Create account"}
      </Button>

      <p className="text-curb-600">
        Already have an account? <AuthLink href="/login">Sign in</AuthLink>
      </p>
    </form>
  );
}
