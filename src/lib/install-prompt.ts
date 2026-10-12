/**
 * The decisions behind the home screen's "add to home screen" card, kept pure
 * so they are testable with no DOM -- the same split `pin-session.ts` and
 * `display-sections.ts` use. The hook in `use-install-prompt.ts` only gathers
 * the browser facts and feeds them in here.
 */

export type InstallPlatform = "ios" | "android" | "other";

/**
 * What the card should do:
 * - `native`: the browser handed us an install prompt; one tap installs.
 * - `ios-steps`: Safari has no install API, so we can only show the steps.
 * - `none`: stay out of the way.
 */
export type InstallMode = "native" | "ios-steps" | "none";

/** A staff member who said "Not now" is left alone for two weeks. */
export const DISMISS_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export const DISMISS_STORAGE_KEY = "pickup-board:install-dismissed-at";

export interface PlatformFacts {
  userAgent: string;
  /** `navigator.maxTouchPoints`; iPadOS claims to be a Mac and only this gives it away. */
  maxTouchPoints: number;
}

export function detectPlatform({
  userAgent,
  maxTouchPoints,
}: PlatformFacts): InstallPlatform {
  if (/iPhone|iPad|iPod/.test(userAgent)) return "ios";
  if (/Macintosh/.test(userAgent) && maxTouchPoints > 1) return "ios";
  if (/Android/.test(userAgent)) return "android";
  return "other";
}

/** `raw` comes off storage, so anything unparseable counts as "never dismissed". */
export function parseDismissedAt(raw: string | null): number | null {
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function isDismissed(
  dismissedAt: number | null,
  now: number,
  ttlMs: number = DISMISS_TTL_MS,
): boolean {
  if (dismissedAt === null) return false;
  // A timestamp in the future (clock change) must not mute the card forever.
  if (dismissedAt > now) return false;
  return now - dismissedAt < ttlMs;
}

export interface InstallFacts {
  platform: InstallPlatform;
  /** Already launched from the home screen: nothing left to install. */
  standalone: boolean;
  /** A captured `beforeinstallprompt` event is waiting to be used. */
  hasNativePrompt: boolean;
  dismissed: boolean;
}

export function chooseInstallMode({
  platform,
  standalone,
  hasNativePrompt,
  dismissed,
}: InstallFacts): InstallMode {
  if (standalone || dismissed) return "none";
  // The card is for phones and tablets. A desktop browser that fires the event
  // is somebody at the office computer, who has no use for a home screen icon.
  if (platform === "other") return "none";
  if (hasNativePrompt) return "native";
  if (platform === "ios") return "ios-steps";
  // Android without the event (Firefox, or the prompt already used): there is
  // nothing honest to offer, so say nothing.
  return "none";
}
