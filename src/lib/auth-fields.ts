/**
 * Field checks for the sign-up and sign-in forms. They catch the obvious
 * mistakes before a round trip; Supabase Auth stays the real authority (it
 * will still reject a bad address or a weak password on its own terms).
 */

export const MIN_PASSWORD_LENGTH = 8;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateEmail(email: string): string | null {
  const value = email.trim();
  if (value === "") return "Enter your email address.";
  if (!EMAIL_SHAPE.test(value)) {
    return "That does not look like an email address.";
  }
  return null;
}

/** Not trimmed: a space is a legitimate password character. */
export function validatePassword(password: string): string | null {
  if (password === "") return "Enter a password.";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

export type ValidationResult<V, K extends string> =
  { ok: true; values: V } | { ok: false; errors: FieldErrors<K> };

export interface SignUpInput {
  schoolName: string;
  email: string;
  password: string;
}

export function validateSignUp(
  input: SignUpInput,
): ValidationResult<SignUpInput, keyof SignUpInput> {
  const errors: FieldErrors<keyof SignUpInput> = {};
  const schoolName = input.schoolName.trim();
  if (schoolName === "") errors.schoolName = "Enter your school's name.";
  const email = validateEmail(input.email);
  if (email) errors.email = email;
  const password = validatePassword(input.password);
  if (password) errors.password = password;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      schoolName,
      email: input.email.trim(),
      password: input.password,
    },
  };
}

export interface LoginInput {
  email: string;
  password: string;
}

/**
 * Sign-in only checks that something was typed. Enforcing the length rule here
 * would lock out an account created under an older rule.
 */
export function validateLogin(
  input: LoginInput,
): ValidationResult<LoginInput, keyof LoginInput> {
  const errors: FieldErrors<keyof LoginInput> = {};
  const email = validateEmail(input.email);
  if (email) errors.email = email;
  if (input.password === "") errors.password = "Enter your password.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: { email: input.email.trim(), password: input.password },
  };
}
