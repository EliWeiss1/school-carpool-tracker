"use client";

import type { PointerEvent as ReactPointerEvent } from "react";

import { cn } from "@/lib/cn";
import type { SpeechStatus } from "@/lib/speech-mock";

/** What the mic is doing, in words. The dock shows it in place of the search box. */
export const MIC_CAPTION: Record<SpeechStatus, string> = {
  idle: "Hold to talk",
  connecting: "Connecting…",
  listening: "Listening — let go when done",
  processing: "Matching…",
};

/**
 * The one control a staff member actually needs both hands free to avoid:
 * press, hold, say the last name, let go. Modeled on the pedestrian call
 * button at the curb it is standing next to — round, unmissable, one job —
 * which is also why it lives at the bottom of the screen, under the thumb.
 *
 * It sits beside the search box in `AnnounceDock` rather than on a stage of
 * its own: the 112px button and its caption used to take over a quarter of a
 * phone's height, which left room for one candidate out of three. The
 * caption moved into the dock, where it replaces the search box while the
 * mic is open -- the one thing on screen that is irrelevant at that moment.
 *
 * Purely presentational: it reports press/release, `announce-screen.tsx`
 * decides what those mean.
 */
export function PushToTalkButton({
  status,
  disabledReason,
  onPressStart,
  onPressEnd,
}: {
  status: SpeechStatus;
  /** When set, voice capture is not available at all and the button is inert. */
  disabledReason?: string;
  onPressStart: () => void;
  onPressEnd: () => void;
}) {
  const disabled = disabledReason !== undefined;
  const listening = status === "listening";
  const busy = status === "connecting" || status === "processing";

  /**
   * Pointer capture is a nicety -- it keeps the press alive if a thumb slides
   * off the button mid-sentence -- but both calls throw `InvalidPointerId` if
   * the pointer is no longer active, and an exception here used to abort the
   * handler before it ever reached `onPressEnd`. That leaves the microphone
   * stuck open with the screen saying "listening", one-handed, outdoors, with
   * a queue of cars waiting. Capture is therefore best-effort, and starting
   * and stopping the mic is not.
   */
  function capture(button: HTMLButtonElement, pointerId: number) {
    try {
      button.setPointerCapture(pointerId);
    } catch {
      // No capture; a thumb sliding off will end the press early, which is
      // recoverable. Failing to start the mic is not.
    }
  }

  function releaseCapture(button: HTMLButtonElement, pointerId: number) {
    try {
      button.releasePointerCapture(pointerId);
    } catch {
      // Already released, or never captured. Either way the mic still stops.
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (disabled || busy) return;
    capture(event.currentTarget, event.pointerId);
    onPressStart();
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    if (disabled) return;
    releaseCapture(event.currentTarget, event.pointerId);
    onPressEnd();
  }

  return (
    // 64px: tap-lg, the floor for every control on /announce.
    <div className="relative flex h-16 w-16 shrink-0 items-center justify-center">
      {listening && (
        <>
          <span
            aria-hidden="true"
            className="absolute inset-0 animate-listen-pulse rounded-full bg-marigold-500"
          />
          <span
            aria-hidden="true"
            className="absolute inset-0 animate-listen-pulse rounded-full bg-marigold-500 [animation-delay:0.45s]"
          />
        </>
      )}

      <button
        type="button"
        disabled={disabled}
        aria-pressed={listening}
        aria-label={disabledReason ?? MIC_CAPTION[status]}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={(event) => event.preventDefault()}
        className={cn(
          "focus-ring relative flex h-16 w-16 touch-none select-none items-center justify-center rounded-full transition-[transform,background-color,box-shadow] duration-150 ease-spring",
          "disabled:pointer-events-none disabled:opacity-40",
          listening
            ? "scale-105 bg-marigold-400 text-curb-900 shadow-float"
            : busy
              ? "bg-marigold-300 text-curb-800 shadow-card"
              : "bg-marigold-500 text-curb-900 shadow-float hover:bg-marigold-400 active:scale-95 active:bg-marigold-600 active:shadow-press",
        )}
      >
        <MicGlyph className="h-8 w-8" />
      </button>
    </div>
  );
}

function MicGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
    </svg>
  );
}
