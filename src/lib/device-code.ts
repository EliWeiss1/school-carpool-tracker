/**
 * The client-side half of the device-code rule. The server owns the final say
 * (`supabase/functions/_shared/device-code.ts`); this mirrors it so a typo is
 * caught before a request, and so the dialog can show what will be saved.
 */

import type { CodeTarget, SchoolDeviceInfo } from "@/lib/school-api";

export const MIN_CODE_LENGTH = 6;
export const MAX_CODE_LENGTH = 20;

export const CODE_RULE_MESSAGE =
  "Use 6 to 20 letters and numbers for the code.";

/** Uppercase, with spaces and dashes removed: "abc-123" is "ABC123". */
export function normalizeDeviceCode(input: string): string {
  return input.trim().toUpperCase().replace(/[\s-]/g, "");
}

/** A sentence to show, or null when the code is acceptable. */
export function validateDeviceCode(input: string): string | null {
  const code = normalizeDeviceCode(input);
  const ok =
    code.length >= MIN_CODE_LENGTH &&
    code.length <= MAX_CODE_LENGTH &&
    /^[A-Z0-9]+$/.test(code);
  return ok ? null : CODE_RULE_MESSAGE;
}

/**
 * Which devices a code change with "disconnect" removes. Mirrors
 * `set_school_code`: a device goes if it holds the capability the changed code
 * grants, so a phone that can do both goes with either code.
 */
export function devicesDisconnectedBy(
  devices: readonly SchoolDeviceInfo[],
  which: CodeTarget,
): SchoolDeviceInfo[] {
  return devices.filter(
    (device) =>
      ((which === "announce" || which === "both") && device.canAnnounce) ||
      ((which === "display" || which === "both") && device.canDisplay),
  );
}

/** "1 device" / "3 devices". */
export function deviceCountLabel(count: number): string {
  return `${count} ${count === 1 ? "device" : "devices"}`;
}

/** What a device can do, in the words the office uses. */
export function deviceAbilityLabel(device: SchoolDeviceInfo): string {
  if (device.canAnnounce && device.canDisplay) return "Announce and board";
  if (device.canAnnounce) return "Announce";
  if (device.canDisplay) return "Board";
  return "No access";
}

export function deviceName(device: SchoolDeviceInfo): string {
  const label = device.label?.trim();
  return label ? label : "Unnamed device";
}
