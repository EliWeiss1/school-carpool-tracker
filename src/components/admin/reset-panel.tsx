"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { adminApi } from "@/lib/admin-api";
import { ApiError } from "@/lib/api";
import type { UsePinSession } from "@/lib/use-pin-session";
import type { Student } from "@/types/db";

export interface ResetPanelProps {
  session: UsePinSession;
  students: Student[] | null;
  /** Re-fetches the roster so the table above reflects the reset immediately. */
  onReset: () => Promise<void>;
}

function requireCredentials(session: UsePinSession) {
  const credentials = session.credentials();
  if (credentials === null) {
    throw new ApiError(
      "pin",
      401,
      "The staff session timed out. Enter the PIN again.",
    );
  }
  return credentials;
}

/**
 * The morning "clear the board" action. Two clicks, not one: the first opens
 * a confirmation naming exactly how many students it will touch, drawn from
 * the same roster the table above shows, so this can never surprise anyone
 * with a bigger change than what they saw on screen.
 *
 * The endpoint itself only moves students that are actually `arrived`, so
 * pressing this a second time by mistake is a no-op, not a second wave of
 * (fabricated) history.
 */
export function ResetPanel({ session, students, onReset }: ResetPanelProps) {
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const arrivedCount =
    students?.filter((student) => student.status === "arrived").length ?? null;

  async function confirmReset() {
    setResetting(true);
    setError(null);
    try {
      const outcome = await adminApi.resetAllToWaiting(
        requireCredentials(session),
      );
      setResult(
        outcome.reset === 0
          ? "Nobody needed resetting -- the board was already clear."
          : `Reset ${outcome.reset} student${outcome.reset === 1 ? "" : "s"} to waiting.`,
      );
      setConfirming(false);
      await onReset();
    } catch (caught: unknown) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "The reset did not go through. Try again.",
      );
    } finally {
      setResetting(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-waiting-border bg-waiting-soft p-6 shadow-card">
      <div>
        <h2 className="font-display text-2xl font-bold text-waiting-deep">
          Reset the board
        </h2>
        <p className="mt-1 text-curb-700">
          Moves every arrived student back to waiting, for the start of a new
          day. Students already waiting are not touched.
        </p>
      </div>

      {result && (
        <ErrorBanner tone="warning" message={result} />
      )}
      {error && <ErrorBanner message={error} />}

      {!confirming ? (
        <div>
          <Button
            variant="danger"
            size="md"
            disabled={arrivedCount === null}
            onClick={() => {
              setResult(null);
              setError(null);
              setConfirming(true);
            }}
          >
            Reset all to waiting
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-xl border border-waiting bg-white p-4">
          <p className="font-medium text-curb-900">
            {arrivedCount === 0
              ? "No student is currently marked arrived. Reset anyway?"
              : `This will move ${arrivedCount} arrived student${arrivedCount === 1 ? "" : "s"} back to waiting.`}
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="quiet"
              size="md"
              onClick={() => setConfirming(false)}
              disabled={resetting}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="md"
              onClick={() => void confirmReset()}
              disabled={resetting}
            >
              {resetting
                ? "Resetting…"
                : `Yes, reset${arrivedCount ? ` ${arrivedCount}` : ""}`}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
