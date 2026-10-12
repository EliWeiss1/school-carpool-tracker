"use client";

import type { PointerEvent as ReactPointerEvent } from "react";

import { cn } from "@/lib/cn";
import type { SpeechStatus } from "@/lib/speech-mock";

const CAPTION: Record<SpeechStatus, string> = {
  idle: "Hold to talk",
  connecting: "Connecting…",
  listening: "Listening — let go when done",
  processing: "Matching…",
};

/**
 * The one control a staff member actually needs both hands free to avoid:
 * press, hold, say the last name, let go. Modeled on the pedestrian call
 * button at the curb it is standing next to — round, unmissable, one job —
 * which is also why it lives fixed to the bottom of the screen rather than
 * pinned up top with everything else a phone UI defaults to.
 *
 * Purely presentational: it reports press/release, `announce-screen.tsx`
 * decides what those mean.
 */
export function PushToTalkButton({
  status,
  disabledReason,
  compact = false,
  onPressStart,
  onPressEnd,
}: {
  status: SpeechStatus;
  /** When set, voice capture is not available at all and the button is inert. */
  disabledReason?: string;
  /**
   * A shorter bar -- the button beside its caption instead of above it -- for
   * when something else (the class drawer) needs the height. The target is
   * still 64px, the app's floor for anything on this screen.
   */
  compact?: boolean;
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
    <div
      className={cn(
        "flex items-center",
        compact ? "flex-row justify-center gap-4" : "flex-col gap-3",
      )}
    >
      <div
        className={cn(
          "relative flex shrink-0 items-center justify-center",
          compact ? "h-16 w-16" : "h-28 w-28",
        )}
      >
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
          aria-label={disabledReason ?? CAPTION[status]}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onContextMenu={(event) => event.preventDefault()}
          className={cn(
            compact ? "h-16 w-16" : "h-28 w-28",
            "focus-ring relative flex touch-none select-none items-center justify-center rounded-full font-display text-base font-bold transition-[transform,background-color,box-shadow] duration-150 ease-spring",
            "disabled:pointer-events-none disabled:opacity-40",
            listening
              ? "scale-105 bg-marigold-400 text-curb-900 shadow-float"
              : busy
                ? "bg-marigold-300 text-curb-800 shadow-card"
                : "bg-marigold-500 text-curb-900 shadow-float active:scale-95 active:bg-marigold-600 active:shadow-press",
          )}
        >
          <MicGlyph className={compact ? "h-6 w-6" : "h-9 w-9"} />
        </button>
      </div>

      {/* The eyebrow treatment is for one- and two-word labels. A whole
          sentence set in wide-tracked caps is markedly harder to read, which
          is the opposite of what an explanation is for -- so the mic status
          keeps it and the explanation drops to sentence case. */}
      <p
        role="status"
        aria-live="polite"
        className={cn(
          "min-h-[1.5rem]",
          compact ? "min-w-0 text-left" : "text-center",
          disabledReason
            ? "text-sm leading-snug text-curb-600"
            : "font-mono text-sm uppercase tracking-eyebrow text-curb-600",
        )}
      >
        {disabledReason ?? CAPTION[status]}
      </p>
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
