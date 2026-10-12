"use client";

/**
 * React's view of "can this device add the app to its home screen?". All of the
 * rules live in `install-prompt.ts`; this only gathers the browser facts that
 * cannot be known on the server and wires up the two events involved.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  DISMISS_STORAGE_KEY,
  chooseInstallMode,
  detectPlatform,
  isDismissed,
  parseDismissedAt,
  type InstallMode,
  type InstallPlatform,
} from "@/lib/install-prompt";

/** Chromium-only and absent from lib.dom, so it is described here. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface UseInstallPrompt {
  mode: InstallMode;
  /** Opens the browser's own install dialog. Only meaningful in `native` mode. */
  install(): Promise<void>;
  /** "Not now": hides the card for a couple of weeks. */
  dismiss(): void;
}

// localStorage can throw (private windows, blocked site data). The card is a
// convenience, so a failure here means it is simply shown again next visit.
function readDismissedAt(): number | null {
  try {
    return parseDismissedAt(window.localStorage.getItem(DISMISS_STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeDismissedAt(now: number): void {
  try {
    window.localStorage.setItem(DISMISS_STORAGE_KEY, String(now));
  } catch {
    // Best effort; see above.
  }
}

function isStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean })
    .standalone;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    iosStandalone === true
  );
}

export function useInstallPrompt(): UseInstallPrompt {
  // Everything starts "unknown" and is filled in after mount, so the server and
  // the first client render agree (no card) and there is no hydration mismatch.
  const [platform, setPlatform] = useState<InstallPlatform>("other");
  const [standalone, setStandalone] = useState(true);
  const [dismissed, setDismissed] = useState(true);
  const [hasNativePrompt, setHasNativePrompt] = useState(false);
  const promptEvent = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    setPlatform(
      detectPlatform({
        userAgent: navigator.userAgent,
        maxTouchPoints: navigator.maxTouchPoints,
      }),
    );
    setStandalone(isStandalone());
    setDismissed(isDismissed(readDismissedAt(), Date.now()));

    const onBeforeInstallPrompt = (event: Event) => {
      // Hold the event back so our card, not the browser's mini-infobar, is the
      // one place the prompt appears.
      event.preventDefault();
      promptEvent.current = event as BeforeInstallPromptEvent;
      setHasNativePrompt(true);
    };
    const onInstalled = () => {
      promptEvent.current = null;
      setHasNativePrompt(false);
      setStandalone(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = useCallback(() => {
    writeDismissedAt(Date.now());
    setDismissed(true);
  }, []);

  const install = useCallback(async () => {
    const event = promptEvent.current;
    if (event === null) return;
    // An install prompt can be shown once per event, whatever the answer.
    promptEvent.current = null;
    setHasNativePrompt(false);
    await event.prompt();
    const { outcome } = await event.userChoice;
    // `appinstalled` handles "accepted"; a refusal is treated like "Not now".
    if (outcome === "dismissed") dismiss();
  }, [dismiss]);

  return {
    mode: chooseInstallMode({
      platform,
      standalone,
      hasNativePrompt,
      dismissed,
    }),
    install,
    dismiss,
  };
}
