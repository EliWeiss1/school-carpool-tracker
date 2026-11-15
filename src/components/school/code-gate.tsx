"use client";

import { type FormEvent, useId, useState } from "react";

import { Field } from "@/components/auth/field";
import { GateFrame } from "@/components/school/gate-frame";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { ApiError } from "@/lib/api";
import {
  cleanDeviceLabel,
  DEVICE_LABEL_MAX_LENGTH,
  gateNotice,
  type NeedsCodeReason,
  normalizeCode,
  type ScreenNeed,
  validateCode,
} from "@/lib/school-access";
import { pairDevice } from "@/lib/supabase/device";

const HELP: Record<"announce" | "display" | "hub", string> = {
  announce: "Ask the office for the announce code.",
  display: "Ask the office for the board code.",
  hub: "The office has one code for phones at the curb and one for the board.",
};

/**
 * The code prompt for a phone or wall board that is not connected (or is
 * connected for the other job). It is not a security boundary: `pair-device`
 * checks the code, and every screen call is checked again by the server.
 *
 * It must not confirm that a school exists, so it never shows the school's name
 * -- the slug in the address is only sent along with the code.
 */
export function CodeGate({
  slug,
  need,
  reason,
  onConnected,
}: {
  slug: string;
  need: Exclude<ScreenNeed, "office">;
  reason: NeedsCodeReason;
  onConnected: () => void;
}) {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const codeId = useId();
  const onInk = need === "display";
  const notice = gateNotice(need, reason);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problem = validateCode(code);
    setFieldError(problem);
    setMessage(null);
    if (problem) return;

    setConnecting(true);
    try {
      await pairDevice({
        schoolSlug: slug,
        code: normalizeCode(code),
        label: cleanDeviceLabel(label),
      });
      setCode("");
      onConnected();
    } catch (error: unknown) {
      setMessage(
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Could not connect. Check the wifi, then try again.",
      );
      setConnecting(false);
    }
  }

  return (
    <GateFrame ground={onInk ? "ink" : "light"}>
      <form
        onSubmit={submit}
        noValidate
        className="w-full max-w-md rounded-2xl border border-curb-200 bg-white p-6 shadow-float"
      >
        <h1 className="font-display text-2xl font-extrabold tracking-display text-curb-900 sm:text-3xl">
          Enter your school&rsquo;s code
        </h1>
        <p className="mt-2 text-curb-600">{HELP[need]}</p>

        {notice && (
          <ErrorBanner tone="warning" className="mt-4" message={notice} />
        )}

        <label
          htmlFor={codeId}
          className="mt-6 block font-display text-base font-semibold text-curb-900"
        >
          Code
        </label>
        <input
          id={codeId}
          name="code"
          type="text"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          autoFocus
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          data-lpignore="true"
          data-1p-ignore="true"
          data-bwignore="true"
          disabled={connecting}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? `${codeId}-error` : undefined}
          className={`focus-ring mt-2 min-h-tap-lg w-full rounded-xl border bg-curb-50 px-4 text-center font-mono text-3xl uppercase tracking-[0.2em] text-curb-900 transition-colors duration-150 placeholder:text-curb-400 hover:border-curb-400 disabled:opacity-50 ${
            fieldError ? "border-2 border-marigold-600" : "border-curb-300"
          }`}
        />
        {fieldError && (
          <p
            id={`${codeId}-error`}
            role="alert"
            className="mt-2 text-sm font-semibold text-curb-900"
          >
            {fieldError}
          </p>
        )}

        <div className="mt-6">
          <Field
            label="Name this device (optional)"
            name="deviceLabel"
            value={label}
            onChange={(value) =>
              setLabel(value.slice(0, DEVICE_LABEL_MAX_LENGTH))
            }
            autoComplete="off"
            hint="For example, Front gate phone. The office sees it in its device list."
            disabled={connecting}
          />
        </div>

        {message && <ErrorBanner className="mt-4" message={message} />}

        <Button
          type="submit"
          size="tap"
          fullWidth
          className="mt-6"
          disabled={connecting}
        >
          {connecting ? "Connecting" : "Connect"}
        </Button>

        <p className="mt-4 text-center text-sm text-curb-500">
          You only enter this once. The device stays connected until the office
          disconnects it.
        </p>
      </form>
    </GateFrame>
  );
}
