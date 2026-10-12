"use client";

import { useEffect } from "react";

/**
 * Registers `public/sw.js`, which is what lets Chrome offer to install the app.
 * Production only: a worker in `next dev` fights hot reload for no benefit.
 * Renders nothing; a failed registration just means no install prompt, so it is
 * swallowed rather than shown to someone standing at the curb.
 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  return null;
}
