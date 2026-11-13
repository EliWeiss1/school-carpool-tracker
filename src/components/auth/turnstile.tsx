"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { publicEnv } from "@/lib/env";

/**
 * Cloudflare Turnstile, loaded only when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is
 * set. With no key nothing renders and the third-party script is never
 * requested, so a deployment without captcha pays nothing for it.
 */

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      theme?: "light" | "dark" | "auto";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

function currentApi(): TurnstileApi | undefined {
  return (window as unknown as { turnstile?: TurnstileApi }).turnstile;
}

let loading: Promise<TurnstileApi> | undefined;

/** One script tag for the whole page, however many forms mount a widget. */
function loadTurnstile(): Promise<TurnstileApi> {
  const ready = currentApi();
  if (ready) return Promise.resolve(ready);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      const api = currentApi();
      if (api) resolve(api);
      else reject(new Error("Turnstile did not initialise."));
    };
    script.onerror = () => {
      // Let a later mount try again instead of caching the failure.
      loading = undefined;
      reject(new Error("Turnstile failed to load."));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export interface TurnstileHandle {
  reset(): void;
}

export const Turnstile = forwardRef<
  TurnstileHandle,
  { siteKey: string; onToken: (token: string | null) => void }
>(function Turnstile({ siteKey, onToken }, ref) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const apiRef = useRef<TurnstileApi | null>(null);
  const [failed, setFailed] = useState(false);

  // Held in a ref so a parent re-render does not rebuild the widget.
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useImperativeHandle(ref, () => ({
    reset() {
      if (apiRef.current && widgetId.current) {
        apiRef.current.reset(widgetId.current);
      }
    },
  }));

  useEffect(() => {
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !container.current) return;
        apiRef.current = api;
        widgetId.current = api.render(container.current, {
          sitekey: siteKey,
          theme: "light",
          callback: (token) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(null),
          "error-callback": () => onTokenRef.current(null),
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (apiRef.current && widgetId.current) {
        apiRef.current.remove(widgetId.current);
      }
      widgetId.current = null;
    };
  }, [siteKey]);

  return (
    <div>
      <div ref={container} />
      {failed && (
        <p role="alert" className="text-sm font-semibold text-curb-900">
          The security check did not load. Reload the page and try again.
        </p>
      )}
    </div>
  );
});

/**
 * Captcha state for a form. `enabled` is false when no site key is configured,
 * in which case the form skips the widget and sends no `captchaToken`.
 */
export function useCaptcha() {
  const siteKey = publicEnv.turnstileSiteKey;
  const [token, setToken] = useState<string | null>(null);
  const handle = useRef<TurnstileHandle>(null);

  /** A Turnstile token is single use, so every attempt needs a fresh one. */
  const reset = useCallback(() => {
    setToken(null);
    handle.current?.reset();
  }, []);

  return {
    siteKey,
    enabled: Boolean(siteKey),
    token,
    setToken,
    handle,
    reset,
    /** The `options.captchaToken` spread for supabase-js, or nothing. */
    options: token ? { captchaToken: token } : {},
  };
}

export const CAPTCHA_PENDING_MESSAGE =
  "Wait for the security check below to finish, then try again.";
