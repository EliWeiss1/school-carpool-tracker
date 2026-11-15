/**
 * Turning a screen's credentials into the shape `school-api.ts` wants.
 *
 * The office panels only make sense for a signed-in account: a PIN or a missing
 * credential means "not signed in" here, so they ask for this at the moment of
 * each request and never keep the access token in state.
 */

import { ApiError, type Credentials } from "@/lib/api";
import type { SchoolScoped } from "@/lib/school-api";

export const SIGNED_OUT_MESSAGE = "You are no longer signed in. Sign in again.";

/** The auth fields for one request, or null if there is no usable session. */
export function schoolAuthFrom(
  credentials: Credentials | null,
): SchoolScoped | null {
  if (credentials === null || !("accessToken" in credentials)) return null;
  return {
    schoolId: credentials.schoolId,
    accessToken: credentials.accessToken,
    deviceId: credentials.deviceId,
  };
}

/** The server's own sentence when it sent one, else a fallback. */
export function messageFrom(caught: unknown, fallback: string): string {
  return caught instanceof ApiError ? caught.message : fallback;
}

/** True when the server says these credentials no longer work. */
export function isSignedOutError(caught: unknown): boolean {
  return caught instanceof ApiError && caught.kind === "pin";
}
