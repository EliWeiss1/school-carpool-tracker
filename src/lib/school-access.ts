/**
 * The decisions behind a school route's gate, kept pure so every combination
 * can be tested with no DOM and no Supabase (the same split `pin-session.ts`
 * and `display-sections.ts` use). `school-gate.tsx` only gathers the facts and
 * feeds them in here.
 */

import { SLUG_PATTERN } from "@/lib/school-slug";

/** What a school route needs from the visitor. */
export type ScreenNeed = "announce" | "display" | "office" | "hub";

/** What a device's own `school_devices` row says it may do. */
export interface DeviceFacts {
  canAnnounce: boolean;
  canDisplay: boolean;
}

export interface AccessFacts {
  /** The signed-in account belongs to this school. */
  isOffice: boolean;
  /** This device's row for this school, or null if it has none. */
  device: DeviceFacts | null;
}

export type NeedsCodeReason = "not-connected" | "wrong-capability";

export type AccessDecision =
  | { kind: "office" }
  | { kind: "device"; canAnnounce: boolean; canDisplay: boolean }
  | { kind: "needs-code"; reason: NeedsCodeReason }
  | { kind: "needs-office-login" };

/** What the device row grants for this screen. Office screens grant nothing. */
function deviceAllows(device: DeviceFacts | null, need: ScreenNeed): boolean {
  if (device === null) return false;
  switch (need) {
    case "announce":
      return device.canAnnounce;
    case "display":
      return device.canDisplay;
    case "hub":
      return device.canAnnounce || device.canDisplay;
    case "office":
      return false;
  }
}

/**
 * `isOffice` means a live office session for this school (the account belongs
 * to it and is still signed in).
 *
 * A paired device wins over an office login whenever it already has what the
 * screen needs. A board or curb phone must keep running on its own session, so
 * an office sign-out in the same browser can never knock it off; the office
 * session is only the fallback when there is no usable device session.
 */
export function decideAccess(
  facts: AccessFacts,
  need: ScreenNeed,
): AccessDecision {
  const { device } = facts;

  if (deviceAllows(device, need) && device !== null) {
    return {
      kind: "device",
      canAnnounce: device.canAnnounce,
      canDisplay: device.canDisplay,
    };
  }

  if (facts.isOffice) return { kind: "office" };

  // The office screens never take a device: a code for a phone must not open
  // the roster.
  if (need === "office") return { kind: "needs-office-login" };

  const hasAnything =
    device !== null && (device.canAnnounce || device.canDisplay);
  return {
    kind: "needs-code",
    reason: hasAnything ? "wrong-capability" : "not-connected",
  };
}

// --- Keeping a mounted device honest ----------------------------------------

/** How often a mounted device session re-reads its own access. */
export const RECHECK_INTERVAL_MS = 60_000;

/** The result of reading this device's own `school_devices` row. */
export type DeviceLookup =
  { ok: false } | { ok: true; device: DeviceFacts | null };

export type RecheckOutcome =
  | { action: "keep" }
  | { action: "update"; canAnnounce: boolean; canDisplay: boolean }
  | { action: "show-code"; reason: NeedsCodeReason };

/**
 * What a mounted device session does with a fresh look at its row. A failed
 * lookup (wifi blinked, a 5xx) changes nothing: a wall board must never drop to
 * the code prompt because the network did. Only a row that is really gone, or
 * has lost the capability this screen needs, takes the screen down. An
 * unchanged answer is "keep", so nothing re-renders and screen state survives.
 */
export function decideRecheck(
  need: Exclude<ScreenNeed, "office">,
  current: DeviceFacts,
  lookup: DeviceLookup,
): RecheckOutcome {
  if (!lookup.ok) return { action: "keep" };

  const decision = decideAccess(
    { isOffice: false, device: lookup.device },
    need,
  );
  if (decision.kind === "needs-code") {
    return { action: "show-code", reason: decision.reason };
  }
  if (decision.kind !== "device") return { action: "keep" };

  return decision.canAnnounce === current.canAnnounce &&
    decision.canDisplay === current.canDisplay
    ? { action: "keep" }
    : {
        action: "update",
        canAnnounce: decision.canAnnounce,
        canDisplay: decision.canDisplay,
      };
}

/** The identity of an access, so a silent re-check can tell "no change". */
export interface AccessIdentity {
  kind: "office" | "device";
  schoolId: string;
  canAnnounce: boolean;
  canDisplay: boolean;
}

export function sameAccess(a: AccessIdentity, b: AccessIdentity): boolean {
  return (
    a.kind === b.kind &&
    a.schoolId === b.schoolId &&
    a.canAnnounce === b.canAnnounce &&
    a.canDisplay === b.canDisplay
  );
}

/** The sentence the gate shows above the code field, or null for none. */
export function gateNotice(
  need: ScreenNeed,
  reason: NeedsCodeReason,
): string | null {
  if (reason !== "wrong-capability") return null;
  return need === "announce"
    ? "This device is connected for the board. Enter the announce code to use it at the curb."
    : "This device is connected for announcing. Enter the board code to use it as the board.";
}

// --- The code field ---------------------------------------------------------

export const CODE_MIN_LENGTH = 6;
export const CODE_MAX_LENGTH = 20;
export const DEVICE_LABEL_MAX_LENGTH = 60;

/** Forgiving about case, spaces and dashes, as the server is. */
export function normalizeCode(input: string): string {
  return input.trim().toUpperCase().replace(/[\s-]/g, "");
}

/** A sentence for the first problem with the typed code, or null if fine. */
export function validateCode(input: string): string | null {
  const code = normalizeCode(input);
  if (code === "") return "Enter your school's code.";
  if (!/^[A-Z0-9]+$/.test(code)) {
    return "A code uses only letters and numbers.";
  }
  if (code.length < CODE_MIN_LENGTH || code.length > CODE_MAX_LENGTH) {
    return `A code is ${CODE_MIN_LENGTH} to ${CODE_MAX_LENGTH} letters and numbers.`;
  }
  return null;
}

/** Trimmed device name, or undefined when blank or too long to send. */
export function cleanDeviceLabel(input: string): string | undefined {
  const label = input.trim();
  return label === "" ? undefined : label.slice(0, DEVICE_LABEL_MAX_LENGTH);
}

// --- Navigation and memory --------------------------------------------------

/** The sign-in page, returning to `path` afterwards. */
export function officeLoginHref(path: string): string {
  return `/login?next=${encodeURIComponent(path)}`;
}

/** localStorage key for the last school this device used. */
export const LAST_SCHOOL_KEY = "carpoolcaller-last-school";

/** The slice of Storage these helpers use, so they test without a browser. */
export interface SlugStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Best effort: storage can be missing or throw (private windows). */
export function rememberLastSchool(
  storage: SlugStorage | null,
  slug: string,
): void {
  if (storage === null || !SLUG_PATTERN.test(slug)) return;
  try {
    storage.setItem(LAST_SCHOOL_KEY, slug);
  } catch {
    // A per-device convenience; losing it costs one tap.
  }
}

/** The remembered slug, only if it still looks like a slug (it becomes a URL). */
export function readLastSchool(storage: SlugStorage | null): string | null {
  if (storage === null) return null;
  try {
    const value = storage.getItem(LAST_SCHOOL_KEY);
    return value !== null && SLUG_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}
