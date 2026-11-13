/**
 * Who is calling, and what they may do in which school.
 *
 * Kept apart from `ports.ts` on purpose: `RosterStore` is one school's data and
 * never learns who is asking, while everything here is about the caller and
 * never touches a roster. The guard is the only thing that joins the two, by
 * turning a verified caller into the school id a scoped store is built from.
 */

/** A Supabase Auth user, as proven by a token the Auth server accepted. */
export interface VerifiedUser {
  userId: string;
  /** True for a device session (anonymous sign-in), false for an office login. */
  isAnonymous: boolean;
  /** Office logins only. A device session has no email to confirm. */
  emailConfirmed: boolean;
}

/** What one user is to one school. */
export type SchoolAccess =
  | { kind: "member"; role: "owner" | "admin" }
  | { kind: "device"; canAnnounce: boolean; canDisplay: boolean };

/**
 * What an endpoint requires of its caller.
 *
 * - `announce`: the curb. An office login, or a device paired with the
 *   announce code.
 * - `office`: roster, classes, carpools, settings. An office login only.
 *
 * There is no `display` capability: the board only reads, and reads go through
 * row-level security, never through an Edge Function.
 */
export type Capability = "announce" | "office";

/** The caller a request was authorised as, for handlers that need to know. */
export type Caller =
  | { kind: "member"; userId: string; role: "owner" | "admin" }
  | { kind: "device"; userId: string }
  /** The shared staff PIN, during rollout only. Always the legacy school. */
  | { kind: "legacy-pin" };

export interface AccessStore {
  /**
   * Asks the Auth server whether this access token is a live user session.
   *
   * Resolves null for anything that is not one: garbage, an expired token, the
   * project's public key, a session the office has disconnected. Throws only
   * when the Auth server could not be reached, so "sign in again" and "try
   * again in a moment" stay different answers.
   */
  verifyToken(token: string): Promise<VerifiedUser | null>;
  /**
   * What `userId` is to `schoolId`, or null when they are nothing to it. A
   * school that does not exist is the same null: callers must not be able to
   * tell "no such school" from "not yours".
   */
  accessFor(userId: string, schoolId: string): Promise<SchoolAccess | null>;
}
