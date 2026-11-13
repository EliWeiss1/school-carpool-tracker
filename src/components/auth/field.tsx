"use client";

import { type ChangeEvent, type ReactNode, useId, useState } from "react";

import { cn } from "@/lib/cn";

/**
 * Labelled text input for the account forms.
 *
 * The error is tied to the input with `aria-describedby` and announced with
 * `role="alert"`. It is not red: red and green mean waiting and arrived in this
 * app and nothing else, so a field in trouble gets a marigold border and a
 * plain-weight sentence instead (form-level failures use `ErrorBanner`).
 */
export interface FieldProps {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "password";
  autoComplete?: string;
  inputMode?: "text" | "email" | "numeric";
  /** One line of help under the field. */
  hint?: ReactNode;
  error?: string | null;
  /** Fixed text inside the left edge of the input, e.g. "/s/". */
  prefix?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Extra attributes some fields need (autocapitalize, spellcheck). */
  autoCapitalize?: string;
  spellCheck?: boolean;
  /** Control on the right edge, such as the password show/hide toggle. */
  trailing?: ReactNode;
  /** The input's id, when the caller needs to focus it. */
  id?: string;
}

export function inputClasses(hasError: boolean, extra?: string): string {
  return cn(
    "focus-ring min-h-tap w-full rounded-xl border bg-curb-50 px-4 text-base text-curb-900",
    "transition-colors duration-150 placeholder:text-curb-400 disabled:opacity-50",
    hasError
      ? "border-2 border-marigold-600"
      : "border-curb-300 hover:border-curb-400",
    extra,
  );
}

export function Field({
  label,
  name,
  value,
  onChange,
  type = "text",
  autoComplete,
  inputMode,
  hint,
  error,
  prefix,
  autoFocus,
  disabled,
  autoCapitalize,
  spellCheck,
  trailing,
  id,
}: FieldProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div>
      <label
        htmlFor={inputId}
        className="block font-display text-base font-semibold text-curb-900"
      >
        {label}
      </label>

      <div className="relative mt-2">
        {prefix && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-4 flex items-center font-mono text-base text-curb-500"
          >
            {prefix}
          </span>
        )}
        <input
          id={inputId}
          name={name}
          type={type}
          value={value}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            onChange(event.target.value)
          }
          autoComplete={autoComplete}
          inputMode={inputMode}
          autoFocus={autoFocus}
          disabled={disabled}
          autoCapitalize={autoCapitalize}
          spellCheck={spellCheck}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={inputClasses(
            Boolean(error),
            cn(
              Boolean(prefix) && "pl-12 font-mono",
              Boolean(trailing) && "pr-24",
            ),
          )}
        />
        {trailing && (
          <div className="absolute inset-y-0 right-0 flex items-center">
            {trailing}
          </div>
        )}
      </div>

      {hint && (
        <p id={hintId} className="mt-2 text-sm text-curb-600">
          {hint}
        </p>
      )}
      {error && (
        <p
          id={errorId}
          role="alert"
          className="mt-2 text-sm font-semibold text-curb-900"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/** A password field with a Show/Hide toggle, so a typo is visible, not guessed. */
export function PasswordField(
  props: Omit<FieldProps, "type" | "trailing" | "inputMode">,
) {
  const [shown, setShown] = useState(false);

  return (
    <Field
      {...props}
      type={shown ? "text" : "password"}
      autoCapitalize="none"
      spellCheck={false}
      trailing={
        <button
          type="button"
          onClick={() => setShown((current) => !current)}
          aria-pressed={shown}
          aria-label={shown ? "Hide password" : "Show password"}
          className="focus-ring mr-1 flex min-h-tap min-w-tap items-center justify-center rounded-xl px-3 font-display text-sm font-semibold text-curb-600 transition-[transform,background-color] duration-150 ease-spring hover:bg-curb-100 hover:text-curb-900 active:scale-[0.98] active:bg-curb-200"
        >
          {shown ? "Hide" : "Show"}
        </button>
      }
    />
  );
}
