/**
 * One plain sentence per Supabase Auth failure. The raw message is never shown:
 * it is written for developers and sometimes leaks internals.
 *
 * Takes `unknown` and reads defensively because the error can be an
 * `AuthError`, a thrown `TypeError` from a dead network, or a plain object.
 */

const GENERIC = "Something went wrong. Try again in a moment.";

interface Fields {
  code: string;
  message: string;
  name: string;
  status: number | null;
}

function fieldsOf(error: unknown): Fields {
  const empty: Fields = { code: "", message: "", name: "", status: null };
  if (typeof error !== "object" || error === null) return empty;
  const e = error as Record<string, unknown>;
  return {
    code: typeof e.code === "string" ? e.code : "",
    message: typeof e.message === "string" ? e.message.toLowerCase() : "",
    name: typeof e.name === "string" ? e.name : "",
    status: typeof e.status === "number" ? e.status : null,
  };
}

export function authErrorMessage(error: unknown): string {
  const { code, message, name, status } = fieldsOf(error);

  if (
    name === "AuthRetryableFetchError" ||
    /failed to fetch|networkerror|network request failed/.test(message)
  ) {
    return "Could not connect. Check the wifi, then try again.";
  }
  if (
    code === "invalid_credentials" ||
    /invalid login credentials/.test(message)
  ) {
    return "Wrong email or password.";
  }
  if (code === "email_not_confirmed" || /email not confirmed/.test(message)) {
    return "Confirm your email first. We sent you a link when you signed up.";
  }
  if (
    code === "user_already_exists" ||
    code === "email_exists" ||
    /already registered/.test(message)
  ) {
    return "That email already has an account. Sign in instead.";
  }
  if (code === "weak_password") {
    return "Choose a stronger password: at least 8 characters, not a common one.";
  }
  if (code === "captcha_failed") {
    return "Could not confirm you are a person. Reload the page and try again.";
  }
  if (
    code === "over_request_rate_limit" ||
    code === "over_email_send_rate_limit" ||
    status === 429
  ) {
    return "Too many attempts. Wait a few minutes, then try again.";
  }
  return GENERIC;
}
