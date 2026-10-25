"use client";

import { type FormEvent, useId } from "react";

import {
  MIC_CAPTION,
  PushToTalkButton,
} from "@/components/announce/push-to-talk-button";
import { cn } from "@/lib/cn";
import type { SpeechStatus } from "@/lib/speech-mock";

/**
 * The bottom of /announce: the typed search and the push-to-talk button on one
 * row, the way a messaging app puts its compose box beside its mic.
 *
 * Both ways of calling a name used to live apart -- the search in a card at
 * the top, the mic on a 185px stage at the bottom -- which left about a
 * seventh of a phone for the candidates they produce, and hid the live
 * suggestions entirely behind the mic bar once the keyboard was up. Docked
 * together at the bottom, they sit under the thumb, ride above the keyboard,
 * and give the whole middle of the screen to names.
 *
 * The search stays available at all times (CLAUDE.md), never behind an error
 * state. Two speeds: every keystroke shows suggestions straight away, matched
 * in the browser against the roster already loaded (`typeahead.ts`) -- no
 * request. Search sends the text to `resolve-name` for what prefix matching
 * cannot do, misspellings and sound-alikes; that call has its own per-device
 * rate limit, which is why it waits for an explicit submit (the keyboard's
 * own search key, or the Search button that appears once there is text).
 *
 * While the mic is open, the search box is covered by what the mic is doing:
 * it is the one thing on screen that is irrelevant at that moment, and the
 * caption needs to be where the eyes already are.
 */
export function AnnounceDock({
  searchText,
  onSearchChange,
  onSearchSubmit,
  onSearchFocus,
  searchDisabled,
  micStatus,
  micDisabledReason,
  onMicPressStart,
  onMicPressEnd,
}: {
  searchText: string;
  onSearchChange: (next: string) => void;
  onSearchSubmit: (event: FormEvent) => void;
  onSearchFocus?: () => void;
  /** True while a resolve is in flight; typing still works, submitting doesn't. */
  searchDisabled?: boolean;
  micStatus: SpeechStatus;
  /** When set, voice capture is not available at all and the mic is inert. */
  micDisabledReason?: string;
  onMicPressStart: () => void;
  onMicPressEnd: () => void;
}) {
  const inputId = useId();
  const micActive = micStatus !== "idle";
  const hasText = searchText.trim() !== "";

  return (
    <div
      className="z-10 flex flex-col gap-2 border-t border-curb-200 bg-white px-4 pt-3"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      {micDisabledReason && (
        <p className="text-sm leading-snug text-curb-600">
          {micDisabledReason}
        </p>
      )}

      {/* The live region stays mounted: one inserted already-populated is not
          reliably announced. The visible overlay below is for sighted users. */}
      <p role="status" aria-live="polite" className="sr-only">
        {micActive ? MIC_CAPTION[micStatus] : ""}
      </p>

      <div className="mx-auto flex w-full max-w-md items-center gap-3">
        <form onSubmit={onSearchSubmit} className="relative min-w-0 flex-1">
          <label htmlFor={inputId} className="sr-only">
            Type a name or carpool
          </label>
          <div
            className={cn(
              "flex min-h-tap-lg items-stretch overflow-hidden rounded-xl border bg-curb-50",
              "border-curb-300 transition-[border-color] duration-150 hover:border-curb-400",
              // The input drops its own outline; the field as a whole takes
              // the app's marigold focus treatment instead.
              "focus-within:border-marigold-500 focus-within:ring-2 focus-within:ring-marigold-500",
            )}
          >
            <input
              id={inputId}
              value={searchText}
              onChange={(event) => onSearchChange(event.target.value)}
              onFocus={onSearchFocus}
              placeholder="Type a name or carpool"
              autoCapitalize="words"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="search"
              className="w-0 min-w-0 flex-1 bg-transparent px-4 text-lg text-curb-900 outline-none placeholder:text-curb-400"
            />
            {hasText && (
              <button
                type="submit"
                disabled={searchDisabled}
                className={cn(
                  "focus-ring shrink-0 border-l border-curb-300 bg-marigold-500 px-4 font-display text-base font-semibold text-curb-900",
                  "transition-[background-color] duration-150",
                  "hover:bg-marigold-400 active:bg-marigold-600 disabled:opacity-50",
                )}
              >
                Search
              </button>
            )}
          </div>

          {micActive && (
            <div
              aria-hidden="true"
              className="absolute inset-0 flex items-center rounded-xl border-2 border-marigold-500 bg-marigold-50 px-4 font-display text-lg font-semibold text-curb-900"
            >
              <span className="truncate">{MIC_CAPTION[micStatus]}</span>
            </div>
          )}
        </form>

        <PushToTalkButton
          status={micStatus}
          disabledReason={micDisabledReason}
          onPressStart={onMicPressStart}
          onPressEnd={onMicPressEnd}
        />
      </div>
    </div>
  );
}
