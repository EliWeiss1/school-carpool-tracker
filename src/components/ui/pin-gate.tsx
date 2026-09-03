"use client";

import { type FormEvent, type ReactNode, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { HazardRule } from "@/components/ui/hazard-rule";
import { ApiError } from "@/lib/api";
import { usePinSession } from "@/lib/use-pin-session";

/**
 * Stands in front of /announce and /admin until a PIN has been entered on this
 * device this session.
 *
 * It is not a security boundary and does not pretend to be one — the Edge
 * Function re-checks the PIN on every single request, including the write path,
 * and this only decides what is on screen. What it *does* guarantee is the rule
 * from CLAUDE.md: the PIN lives in memory for the tab and is never written to
 * storage of any kind.
 *
 * `verify` is optional. Without it the gate opens optimistically and the first
 * real request surfaces a wrong PIN as a 401; a route that would rather find
 * out immediately can pass a cheap read-only probe.
 */
export function PinGate({
  purpose,
  verify,
  children,
}: {
  /** One line saying what the PIN is about to unlock. */
  purpose: string;
  verify?: (pin: string) => Promise<void>;
  children: ReactNode;
}) {
  const session = usePinSession();
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const inputId = useId();

  if (session.unlocked) return <>{children}</>;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const candidate = pin.trim();
    if (candidate === "") {
      setMessage("Enter the staff PIN.");
      return;
    }

    setChecking(true);
    setMessage(null);
    try {
      await verify?.(candidate);
      session.unlock(candidate);
      // Drop the typed value the moment it is handed over, so it is not sitting
      // in component state behind the unlocked screen.
      setPin("");
    } catch (error: unknown) {
      setMessage(
        error instanceof ApiError
          ? error.message
          : "That PIN was not recognised. Check with the office.",
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-curb-50">
      <div className="bg-curb-900 px-6 py-8 text-white">
        <p className="font-mono text-[0.6875rem] uppercase tracking-eyebrow text-marigold-400">
          Staff only
        </p>
        <h1 className="mt-1 font-display text-3xl font-extrabold tracking-display">
          Carpool Pickup Board
        </h1>
      </div>
      <HazardRule />

      <div className="flex flex-1 items-start justify-center px-6 py-12">
        <form
          onSubmit={submit}
          className="w-full max-w-sm rounded-2xl border border-curb-200 bg-white p-6 shadow-float"
        >
          <label
            htmlFor={inputId}
            className="block font-display text-xl font-bold text-curb-900"
          >
            Enter the staff PIN
          </label>
          <p className="mt-1 text-curb-600">{purpose}</p>

          <input
            id={inputId}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            value={pin}
            onChange={(event) => setPin(event.target.value)}
            className="focus-ring mt-6 min-h-tap-lg w-full rounded-xl border border-curb-300 bg-curb-50 px-4 text-center font-mono text-3xl tracking-[0.3em] text-curb-900 transition-colors duration-150 placeholder:text-curb-400 hover:border-curb-400"
            placeholder="&#183;&#183;&#183;&#183;&#183;&#183;"
          />

          {message && <ErrorBanner className="mt-4" message={message} />}

          <Button
            type="submit"
            size="tap"
            fullWidth
            className="mt-6"
            disabled={checking}
          >
            {checking ? "Checking…" : "Unlock"}
          </Button>

          <p className="mt-4 text-center text-sm text-curb-500">
            The PIN is kept until this tab is closed, and nowhere else.
          </p>
        </form>
      </div>
    </main>
  );
}
