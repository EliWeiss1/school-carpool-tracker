"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { HazardRule } from "@/components/ui/hazard-rule";

/**
 * Shown in place of the board until the /display password has been entered.
 * On success the server has set an httpOnly cookie, so a refresh re-renders
 * the page with the board in it -- this component never sees the credential
 * again and holds nothing in storage.
 */
export function DisplayGate({ configured }: { configured: boolean }) {
  const router = useRouter();
  const inputId = useId();
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(
    configured
      ? null
      : "The display password is not set up on the server. Ask whoever installed the app.",
  );
  const [checking, setChecking] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.trim() === "") {
      setMessage("Enter the display password.");
      return;
    }

    setChecking(true);
    setMessage(null);
    try {
      const response = await fetch("/api/display-auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (response.ok) {
        setPassword("");
        router.refresh();
        return;
      }
      const body: unknown = await response.json().catch(() => null);
      const error =
        typeof body === "object" && body !== null && "error" in body
          ? (body as { error: unknown }).error
          : null;
      setMessage(
        typeof error === "string"
          ? error
          : "That password was not recognised. Check with the office.",
      );
    } catch {
      setMessage("Could not reach the server. Check the connection and try again.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-curb-900">
      <div className="px-6 py-8 text-white">
        <p className="font-mono text-[0.6875rem] uppercase tracking-eyebrow text-marigold-400">
          Staff only
        </p>
        <h1 className="mt-1 font-display text-3xl font-extrabold tracking-display">
          CarpoolCaller
        </h1>
      </div>
      <HazardRule />

      <div className="flex flex-1 items-start justify-center px-6 py-12">
        <form
          onSubmit={submit}
          className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-float"
        >
          <label
            htmlFor={inputId}
            className="block font-display text-xl font-bold text-curb-900"
          >
            Enter the display password
          </label>
          <p className="mt-1 text-curb-600">
            This unlocks the pickup board on this screen.
          </p>

          <input
            id={inputId}
            type="password"
            autoComplete="off"
            data-lpignore="true"
            data-1p-ignore="true"
            data-bwignore="true"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="focus-ring mt-6 min-h-tap-lg w-full rounded-xl border border-curb-300 bg-curb-50 px-4 text-center font-mono text-2xl text-curb-900 transition-colors duration-150 hover:border-curb-400"
          />

          {message && <ErrorBanner className="mt-4" message={message} />}

          <Button
            type="submit"
            size="tap"
            fullWidth
            className="mt-6"
            disabled={checking || !configured}
          >
            {checking ? "Checking…" : "Unlock"}
          </Button>

          <p className="mt-4 text-center text-sm text-curb-500">
            This screen stays unlocked until the password changes.
          </p>
        </form>
      </div>
    </main>
  );
}
