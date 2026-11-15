/**
 * What the pair-device and school-write handlers need from storage.
 *
 * Separate from `RosterStore` (one school's roster) and `AccessStore` (who is
 * calling): this is the school itself, its device codes and its devices. The
 * methods that take a `schoolId` are only ever handed one the guard returned.
 */

export interface SchoolSummary {
  id: string;
  name: string;
  slug: string;
  timezone: string;
}

export interface SchoolSettings extends SchoolSummary {
  resetHour: number;
  resetDays: number[];
}

export interface SchoolCodes {
  announceCode: string | null;
  displayCode: string | null;
}

/** A device as the office sees it. Never carries the auth user id. */
export interface DeviceSummary {
  id: string;
  label: string | null;
  canAnnounce: boolean;
  canDisplay: boolean;
  createdAt: string;
  lastSeenAt: string | null;
}

export type CreateSchoolOutcome =
  | { status: "created" | "exists"; school: SchoolSummary }
  | { status: "slug-taken" };

export interface SettingsPatch {
  name?: string;
  timezone?: string;
  resetHour?: number;
  resetDays?: number[];
}

export type CodeTarget = "announce" | "display" | "both";

export interface AttemptPairingInput {
  schoolSlug: string;
  /** Already normalised (see normalizeDeviceCode). */
  code: string;
  /** The device's anonymous auth user. */
  userId: string;
  label: string | null;
  clientIp: string;
}

/**
 * The whole pairing decision. `refused` covers an unknown school and a wrong
 * code alike, on purpose: the caller must not be able to tell them apart.
 */
export type AttemptPairingOutcome =
  | {
      status: "paired";
      school: { id: string; name: string; slug: string };
      canAnnounce: boolean;
      canDisplay: boolean;
    }
  | { status: "refused" }
  | { status: "locked"; lockedUntil: string };

export interface SchoolStore {
  createSchool(input: {
    userId: string;
    name: string;
    slug: string;
    timezone: string;
  }): Promise<CreateSchoolOutcome>;

  updateSettings(
    schoolId: string,
    patch: SettingsPatch,
  ): Promise<SchoolSettings | null>;

  getCodes(schoolId: string): Promise<SchoolCodes>;

  /**
   * Sets (or, with null, clears) a code. With `disconnect`, also removes the
   * devices holding that capability and returns their auth user ids so the
   * caller can delete those sessions.
   */
  setCode(
    schoolId: string,
    which: CodeTarget,
    code: string | null,
    disconnect: boolean,
  ): Promise<SchoolCodes & { disconnectedUserIds: string[] }>;

  listDevices(schoolId: string): Promise<DeviceSummary[]>;

  /**
   * Removes one device row of this school and resolves with that device's auth
   * user id, so the caller can end its session too. Null when nothing was
   * removed: an unknown id, or a row that belongs to another school.
   */
  removeDevice(schoolId: string, deviceRowId: string): Promise<string | null>;

  /**
   * Looks the school up, checks its locks, compares the code, and either counts
   * the failure or records the device -- as one atomic step, so parallel
   * guesses are counted one at a time and a pairing cannot slip in after the
   * office changes the code.
   */
  attemptPairing(input: AttemptPairingInput): Promise<AttemptPairingOutcome>;

  /**
   * Deletes device sessions. The implementation must delete only anonymous
   * users, whatever ids it is handed: an office account is never removed here.
   * Best effort: resolves with the number actually deleted and does not throw
   * for an individual failure.
   */
  deleteDeviceUsers(userIds: string[]): Promise<number>;
}
