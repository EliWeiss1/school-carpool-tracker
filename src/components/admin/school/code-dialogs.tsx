"use client";

import { useId, useState } from "react";

import { ModalSurface } from "@/components/admin/modal-surface";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import {
  deviceCountLabel,
  devicesDisconnectedBy,
  MAX_CODE_LENGTH,
  normalizeDeviceCode,
  validateDeviceCode,
} from "@/lib/device-code";
import type { CodeTarget, SchoolDeviceInfo } from "@/lib/school-api";

import { INPUT_CLASS, LABEL_CLASS } from "./panel-parts";

export type SingleTarget = "announce" | "display";

export const TARGET_NAME: Record<SingleTarget, string> = {
  announce: "Curb phones (announce)",
  display: "Screens (display)",
};

export interface ChangeCodeRequest {
  which: CodeTarget;
  code: string;
  disconnectDevices: boolean;
}

/**
 * Change or first-set a code. The two confirm buttons are separate on purpose:
 * disconnecting devices is the consequence people miss, so it is its own
 * button with its own count rather than a checkbox that might be left ticked.
 */
export function ChangeCodeDialog({
  target,
  hasCode,
  devices,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  target: SingleTarget;
  hasCode: boolean;
  devices: readonly SchoolDeviceInfo[];
  busy: boolean;
  error: string | null;
  onSubmit: (request: ChangeCodeRequest) => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const [code, setCode] = useState("");
  const [both, setBoth] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const which: CodeTarget = both ? "both" : target;
  const affected = devicesDisconnectedBy(devices, which).length;
  const verb = hasCode ? "Change code" : "Set code";

  function submit(disconnectDevices: boolean) {
    const invalid = validateDeviceCode(code);
    setProblem(invalid);
    if (invalid !== null) return;
    onSubmit({ which, code: normalizeDeviceCode(code), disconnectDevices });
  }

  return (
    <ModalSurface
      labelledBy={titleId}
      onClose={onCancel}
      dismissible={!busy}
      dismissOnBackdrop={false}
      initialFocusSelector="input[type=text]"
      className="sm:max-w-lg"
    >
      <form
        className="flex flex-col gap-4 overflow-y-auto p-6"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit(false);
        }}
      >
        <h2
          id={titleId}
          className="font-display text-2xl font-bold text-curb-900"
        >
          {verb}: {TARGET_NAME[target]}
        </h2>

        <div>
          <label htmlFor={`${titleId}-code`} className={LABEL_CLASS}>
            New code
          </label>
          <input
            id={`${titleId}-code`}
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={MAX_CODE_LENGTH + 4}
            value={code}
            aria-invalid={problem !== null}
            aria-describedby={`${titleId}-rule`}
            onChange={(event) => {
              setCode(event.target.value.toUpperCase());
              setProblem(null);
            }}
            className={`${INPUT_CLASS} font-mono uppercase tracking-eyebrow`}
          />
          <p
            id={`${titleId}-rule`}
            className={
              problem
                ? "mt-1 text-sm font-medium text-curb-900"
                : "mt-1 text-sm text-curb-600"
            }
          >
            {problem ??
              "6 to 20 letters and numbers. Spaces and dashes are ignored."}
          </p>
        </div>

        <label className="flex min-h-tap cursor-pointer items-center gap-3 text-curb-900">
          <input
            type="checkbox"
            checked={both}
            onChange={(event) => setBoth(event.target.checked)}
            className="focus-ring h-5 w-5 rounded accent-marigold-500"
          />
          Use the same code for both
        </label>

        {error && <ErrorBanner message={error} />}

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Button type="submit" variant="primary" disabled={busy} fullWidth>
              {busy ? "Saving…" : verb}
            </Button>
            {hasCode && (
              <p className="text-sm text-curb-600">
                Devices already connected stay connected. Only new devices need
                the new code.
              </p>
            )}
          </div>

          {hasCode && (
            <div className="flex flex-col gap-1">
              <Button
                variant="danger"
                disabled={busy || affected === 0}
                fullWidth
                onClick={() => submit(true)}
              >
                {verb} and disconnect its devices
              </Button>
              <p className="text-sm text-curb-600">
                {affected === 0
                  ? "No connected devices use this code."
                  : `This signs out ${deviceCountLabel(affected)}. They will need the new code to connect again.`}
              </p>
            </div>
          )}

          <Button variant="quiet" disabled={busy} fullWidth onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </ModalSurface>
  );
}

/** Confirm clearing a code: nothing new can pair until a code is set again. */
export function TurnOffDialog({
  target,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  target: SingleTarget;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  return (
    <ModalSurface
      labelledBy={titleId}
      onClose={onCancel}
      dismissible={!busy}
      dismissOnBackdrop={false}
      className="sm:max-w-lg"
    >
      <div className="flex flex-col gap-4 p-6">
        <h2
          id={titleId}
          className="font-display text-2xl font-bold text-curb-900"
        >
          Turn off the code for {TARGET_NAME[target]}?
        </h2>
        <p className="text-curb-700">
          Nothing new can connect until you set a code again. Devices already
          connected stay connected.
        </p>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2">
          <Button variant="quiet" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" disabled={busy} onClick={onConfirm}>
            {busy ? "Turning off…" : "Turn off"}
          </Button>
        </div>
      </div>
    </ModalSurface>
  );
}
