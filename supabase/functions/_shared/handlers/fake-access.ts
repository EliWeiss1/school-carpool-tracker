/**
 * An in-memory AccessStore for handler tests: tokens are plain strings mapped
 * to users, and access is a list of grants. No Auth server, no database.
 */

import type {
  AccessStore,
  SchoolAccess,
  VerifiedUser,
} from "../access-ports.ts";

export interface FakeAccess extends AccessStore {
  /** Registers a token the fake Auth server will accept. */
  addUser(
    token: string,
    user: Partial<VerifiedUser> & { userId: string },
  ): void;
  /** Makes `userId` a member or a device of `schoolId`. */
  grant(userId: string, schoolId: string, access: SchoolAccess): void;
  /** Drops a grant, as disconnecting a device does. */
  revoke(userId: string, schoolId: string): void;
  /** Makes the next `verifyToken` throw, as an unreachable Auth server does. */
  failNextVerify(): void;
  /** Every token `verifyToken` was asked about, in order. */
  readonly verified: string[];
}

export function createFakeAccess(): FakeAccess {
  const users = new Map<string, VerifiedUser>();
  const grants = new Map<string, SchoolAccess>();
  const verified: string[] = [];
  let failNext = false;

  const key = (userId: string, schoolId: string) => `${userId}|${schoolId}`;

  return {
    verified,
    addUser(token, user) {
      users.set(token, { isAnonymous: false, emailConfirmed: true, ...user });
    },
    grant(userId, schoolId, access) {
      grants.set(key(userId, schoolId), access);
    },
    revoke(userId, schoolId) {
      grants.delete(key(userId, schoolId));
    },
    failNextVerify() {
      failNext = true;
    },
    verifyToken(token) {
      verified.push(token);
      if (failNext) {
        failNext = false;
        return Promise.reject(new Error("auth server unreachable"));
      }
      return Promise.resolve(users.get(token) ?? null);
    },
    accessFor(userId, schoolId) {
      return Promise.resolve(grants.get(key(userId, schoolId)) ?? null);
    },
  };
}
