"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { deviceAbilityLabel, deviceName } from "@/lib/device-code";
import { lastSeenLabel, relativeTime } from "@/lib/relative-time";
import type { CodesResponse, SchoolDeviceInfo } from "@/lib/school-api";

import {
  ChangeCodeDialog,
  type ChangeCodeRequest,
  TARGET_NAME,
  TurnOffDialog,
  type SingleTarget,
} from "./code-dialogs";
import { PanelCard, PanelGroup } from "./panel-parts";

export interface DevicesCardProps {
  slug: string;
  codes: CodesResponse;
  devices: readonly SchoolDeviceInfo[];
  /** Each rejects with an Error carrying the sentence to show. */
  onChangeCode: (request: ChangeCodeRequest) => Promise<void>;
  onTurnOff: (target: SingleTarget) => Promise<void>;
  onDisconnect: (device: SchoolDeviceInfo) => Promise<void>;
}

/** Share link with a Copy button that says "Copied" for a moment. */
function ShareLink({ slug }: { slug: string }) {
  // The origin is only known in the browser; render the path until then.
  const [origin, setOrigin] = useState("");
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setOrigin(window.location.origin);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  const link = `${origin}/s/${slug}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setState("copied");
    } catch {
      setState("failed");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2500);
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-curb-600">
        Open this link on each phone or screen, then enter its code.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          readOnly
          aria-label="Your school's link"
          value={link}
          onFocus={(event) => event.currentTarget.select()}
          className="focus-ring min-h-tap w-full min-w-0 rounded-xl border border-curb-300 bg-curb-50 px-3.5 font-mono text-base text-curb-900"
        />
        <Button
          variant="secondary"
          className="whitespace-nowrap"
          onClick={() => void copy()}
        >
          {state === "copied" ? "Copied" : "Copy link"}
        </Button>
      </div>
      <p
        role="status"
        aria-live="polite"
        className={
          state === "failed" ? "text-sm font-medium text-curb-900" : "sr-only"
        }
      >
        {state === "failed"
          ? "Copying did not work. Select the link and copy it."
          : state === "copied"
            ? "Link copied."
            : ""}
      </p>
    </div>
  );
}

/** One of the two codes: hidden as dots until Show, like a password field. */
function CodeRow({
  target,
  code,
  onSet,
  onTurnOff,
}: {
  target: SingleTarget;
  code: string | null;
  onSet: () => void;
  onTurnOff: () => void;
}) {
  const [shown, setShown] = useState(false);
  const isSet = code !== null;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-curb-200 bg-curb-50 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-medium text-curb-900">{TARGET_NAME[target]}</p>
        {isSet ? (
          <p className="font-mono text-xl text-curb-900 [overflow-wrap:anywhere]">
            {shown ? code : "•".repeat(code.length)}
            {!shown && <span className="sr-only">Code hidden</span>}
          </p>
        ) : (
          <p className="text-curb-600">Not set: nothing can connect</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {isSet && (
          <Button
            variant="quiet"
            aria-pressed={shown}
            onClick={() => setShown((value) => !value)}
          >
            {shown ? "Hide" : "Show"}
            <span className="sr-only"> the {TARGET_NAME[target]} code</span>
          </Button>
        )}
        <Button variant="secondary" onClick={onSet}>
          {isSet ? "Change code" : "Set code"}
          <span className="sr-only"> for {TARGET_NAME[target]}</span>
        </Button>
        {isSet && (
          <Button variant="quiet" onClick={onTurnOff}>
            Turn off
            <span className="sr-only"> the {TARGET_NAME[target]} code</span>
          </Button>
        )}
      </div>
    </div>
  );
}

function DeviceRow({
  device,
  now,
  onDisconnect,
}: {
  device: SchoolDeviceInfo;
  now: Date;
  onDisconnect: (device: SchoolDeviceInfo) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = deviceName(device);

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      await onDisconnect(device);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not disconnect it. Try again.",
      );
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-curb-200 bg-white p-4 shadow-card">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-medium text-curb-900">{name}</p>
          <p className="text-sm text-curb-600">
            {deviceAbilityLabel(device)}
            <span aria-hidden="true"> · </span>
            <span className="sr-only">, </span>
            Connected {relativeTime(device.createdAt, now).toLowerCase()}
            <span aria-hidden="true"> · </span>
            <span className="sr-only">, </span>
            {device.lastSeenAt === null
              ? "Not seen yet"
              : `Last seen ${lastSeenLabel(device.lastSeenAt, now).toLowerCase()}`}
          </p>
        </div>
        {!confirming && (
          <Button variant="secondary" onClick={() => setConfirming(true)}>
            Disconnect
            <span className="sr-only"> {name}</span>
          </Button>
        )}
      </div>
      {confirming && (
        <div className="flex flex-col gap-3 rounded-xl border border-waiting-border bg-waiting-soft p-4">
          <p className="font-medium text-curb-900">
            Disconnect {name}? It will need the code to connect again.
          </p>
          {error && <ErrorBanner message={error} />}
          <div className="flex justify-end gap-2">
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => void disconnect()}
            >
              {busy ? "Disconnecting…" : "Disconnect"}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

type Dialog =
  | { kind: "change"; target: SingleTarget }
  | { kind: "off"; target: SingleTarget }
  | null;

/** The Devices section: the link, the two codes, and who is connected. */
export function DevicesCard({
  slug,
  codes,
  devices,
  onChangeCode,
  onTurnOff,
  onDisconnect,
}: DevicesCardProps) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = new Date();

  function open(next: Dialog) {
    setError(null);
    setDialog(next);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setDialog(null);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : "That did not go through. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <PanelCard
      id="devices"
      title="Devices"
      intro="Phones and screens join your school with a link and a code."
    >
      <ShareLink slug={slug} />

      <PanelGroup title="Codes">
        <div className="flex flex-col gap-3">
          <CodeRow
            target="announce"
            code={codes.announceCode}
            onSet={() => open({ kind: "change", target: "announce" })}
            onTurnOff={() => open({ kind: "off", target: "announce" })}
          />
          <CodeRow
            target="display"
            code={codes.displayCode}
            onSet={() => open({ kind: "change", target: "display" })}
            onTurnOff={() => open({ kind: "off", target: "display" })}
          />
        </div>
      </PanelGroup>

      <PanelGroup title="Connected devices">
        {devices.length === 0 ? (
          <EmptyState
            title="No devices are connected yet."
            hint="Open your school's link on a phone or a screen and enter the code."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {devices.map((device) => (
              <DeviceRow
                key={device.id}
                device={device}
                now={now}
                onDisconnect={onDisconnect}
              />
            ))}
          </ul>
        )}
      </PanelGroup>

      {dialog?.kind === "change" && (
        <ChangeCodeDialog
          target={dialog.target}
          hasCode={
            (dialog.target === "announce"
              ? codes.announceCode
              : codes.displayCode) !== null
          }
          devices={devices}
          busy={busy}
          error={error}
          onSubmit={(request) => void run(() => onChangeCode(request))}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "off" && (
        <TurnOffDialog
          target={dialog.target}
          busy={busy}
          error={error}
          onConfirm={() => void run(() => onTurnOff(dialog.target))}
          onCancel={() => setDialog(null)}
        />
      )}
    </PanelCard>
  );
}
