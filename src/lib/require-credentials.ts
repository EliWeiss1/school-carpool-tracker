import { ApiError, type Credentials } from "@/lib/api";
import type { SchoolSummary, StaffSession } from "@/lib/screen-access";

/**
 * What to tell someone whose credentials have gone. The legacy routes have a
 * PIN to re-enter; a school route has none, so naming one there would send a
 * person looking for something that does not exist.
 */
export function signedOutMessage(school: SchoolSummary | null): string {
  return school === null
    ? "The staff session timed out. Enter the PIN again."
    : "You are no longer signed in. Sign in or enter the school's code again.";
}

/**
 * The credentials for a request, or the 401 the screens already handle. One
 * copy for every /admin section, replacing five identical local ones.
 */
export function requireCredentials(
  session: Pick<StaffSession, "credentials">,
  school: SchoolSummary | null,
): Credentials {
  const credentials = session.credentials();
  if (credentials === null) {
    throw new ApiError("pin", 401, signedOutMessage(school));
  }
  return credentials;
}
