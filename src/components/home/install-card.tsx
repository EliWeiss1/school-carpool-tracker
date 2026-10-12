"use client";

import Image from "next/image";
import { useId } from "react";

import { Button } from "@/components/ui";
import { useInstallPrompt } from "@/lib/use-install-prompt";

/**
 * Offers to put the app on a phone's home screen, pinned to the bottom of the
 * landing page. It is the floating level of the elevation system: a white card
 * lifted off the page ground by `shadow-float`.
 *
 * It renders nothing on desktop, nothing once the app is installed, and nothing
 * for two weeks after "Not now" -- the page must never nag the people it is
 * meant to help. See `install-prompt.ts` for the rules.
 *
 * `sticky` rather than `fixed`: as the last child of the page's flex column it
 * rests at the viewport's bottom edge while the lane cards scroll beneath it,
 * and it takes up real space at the end of the page, so it can never sit on top
 * of the last card.
 */
export function InstallCard() {
  const { mode, install, dismiss } = useInstallPrompt();
  const headingId = useId();

  if (mode === "none") return null;

  return (
    // The outer band is full-bleed so its fade of page ground can wash out
    // whatever lane card is scrolling underneath; the card itself stays inside
    // the same max-width box as the lane cards above it.
    <section
      aria-labelledby={headingId}
      className="sticky bottom-0 z-40 bg-gradient-to-t from-curb-50 from-75% to-transparent pb-[max(1rem,env(safe-area-inset-bottom))] pt-8"
    >
      <div className="mx-auto w-full max-w-3xl px-6 sm:px-12">
        <div className="animate-tile-in rounded-2xl border border-curb-200 bg-white p-4 shadow-float">
          <div className="flex items-start gap-4">
            <Image
              src="/icons/icon-192.png"
              alt=""
              width={48}
              height={48}
              // A 192px PNG already on our own origin; the optimizer adds nothing.
              unoptimized
              className="mt-1 size-12 shrink-0 rounded-xl"
            />
            <div className="min-w-0 flex-1">
              <h2
                id={headingId}
                className="font-display text-lg font-bold leading-tight text-curb-900"
              >
                Keep CarpoolCaller on your home screen
              </h2>
              {mode === "native" ? (
                <p className="mt-1 text-sm text-curb-600">
                  Opens full screen, one tap away. No app store needed.
                </p>
              ) : (
                <IosSteps />
              )}
            </div>
          </div>

          <div className="mt-4 flex gap-3">
            {mode === "native" && (
              <Button className="flex-1" onClick={install}>
                Install
              </Button>
            )}
            <Button
              variant={mode === "native" ? "quiet" : "secondary"}
              className={mode === "native" ? undefined : "flex-1"}
              onClick={dismiss}
            >
              Not now
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * iOS has no install API, so the only honest thing to do is show the steps. They
 * really are a sequence, which is why they are numbered.
 */
function IosSteps() {
  return (
    <ol className="mt-1 space-y-1 text-sm text-curb-600">
      <li className="flex items-center gap-2">
        <span className="font-mono text-curb-400" aria-hidden="true">
          1
        </span>
        <span>
          Tap <strong className="font-semibold text-curb-800">Share</strong>
        </span>
        <ShareIcon />
      </li>
      <li className="flex items-center gap-2">
        <span className="font-mono text-curb-400" aria-hidden="true">
          2
        </span>
        <span>
          Choose{" "}
          <strong className="font-semibold text-curb-800">
            Add to Home Screen
          </strong>
        </span>
      </li>
    </ol>
  );
}

/** Apple's share glyph: a box with an arrow leaving the top. */
function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5 shrink-0 text-marigold-700"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="the Share button"
    >
      <path d="M12 3v12" />
      <path d="m8 7 4-4 4 4" />
      <path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
    </svg>
  );
}
