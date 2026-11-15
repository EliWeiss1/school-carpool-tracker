/**
 * An in-memory SchoolStore for handler tests. It mirrors the SQL functions'
 * behaviour (lockout window, version bumps, capability-scoped disconnects)
 * closely enough that the handlers' tests exercise the same decisions the
 * database makes.
 */

import type {
  CodeTarget,
  CreateSchoolOutcome,
  DeviceSummary,
  AttemptPairingInput,
  AttemptPairingOutcome,
  SchoolCodes,
  SchoolSettings,
  SchoolStore,
  SettingsPatch,
} from "../school-ports.ts";

interface FakeSchool extends SchoolSettings {
  announceCode: string | null;
  displayCode: string | null;
  /** School-wide ceiling: wrong codes from every address, one-hour window. */
  failedAttempts: number;
  windowStartedAt: number | null;
  lockedUntil: number | null;
  /** Per client address, as school_pair_attempts holds them. */
  ipRows: Map<
    string,
    { attempts: number; windowStartedAt: number; lockedUntil: number | null }
  >;
}

interface FakeDevice extends DeviceSummary {
  schoolId: string;
  userId: string;
}

export interface FakeSchoolStore extends SchoolStore {
  /** Seeds a school directly, as a prior sign-up would have. */
  seedSchool(
    school: Partial<SchoolSettings> & { id: string; slug: string },
    codes?: Partial<SchoolCodes>,
    ownerUserId?: string,
  ): void;
  /** Seeds a paired device. */
  seedDevice(device: {
    id: string;
    schoolId: string;
    userId: string;
    canAnnounce?: boolean;
    canDisplay?: boolean;
    label?: string | null;
  }): void;
  /** Marks a user id as an anonymous (device) session. */
  markAnonymous(userId: string): void;
  /** Makes deleteDeviceUsers throw, as an unreachable Auth admin API does. */
  failDeletingUsers(): void;
  /** Moves the store's clock, which the lockout window is measured on. */
  setNow(ms: number): void;
  readonly now: () => number;
  /** Test readouts. */
  devices(schoolId?: string): FakeDevice[];
  schoolOf(id: string): FakeSchool | undefined;
  readonly deletedUserIds: string[];
  readonly calls: { attemptPairing: number };
}

export function createFakeSchoolStore(startMs = 0): FakeSchoolStore {
  let clock = startMs;
  const schools = new Map<string, FakeSchool>();
  const owners = new Map<string, string>();
  const deviceRows = new Map<string, FakeDevice>();
  const anonymous = new Set<string>();
  const deletedUserIds: string[] = [];
  const calls = { attemptPairing: 0 };
  let failDelete = false;
  let nextId = 1;

  const toSummary = (s: FakeSchool) => ({
    id: s.id,
    name: s.name,
    slug: s.slug,
    timezone: s.timezone,
  });

  return {
    now: () => clock,
    deletedUserIds,
    calls,
    setNow(ms) {
      clock = ms;
    },
    markAnonymous(userId) {
      anonymous.add(userId);
    },
    failDeletingUsers() {
      failDelete = true;
    },
    seedSchool(school, codes = {}, ownerUserId) {
      schools.set(school.id, {
        name: "Seeded School",
        timezone: "UTC",
        resetHour: 20,
        resetDays: [0, 1, 2, 3, 4],
        announceCode: null,
        displayCode: null,
        ...school,
        ...codes,
        failedAttempts: 0,
        windowStartedAt: null,
        lockedUntil: null,
        ipRows: new Map(),
      });
      if (ownerUserId) owners.set(ownerUserId, school.id);
    },
    seedDevice(device) {
      deviceRows.set(device.id, {
        label: null,
        canAnnounce: false,
        canDisplay: false,
        ...device,
        createdAt: new Date(clock).toISOString(),
        lastSeenAt: null,
      });
      anonymous.add(device.userId);
    },
    devices(schoolId) {
      return [...deviceRows.values()].filter(
        (d) => schoolId === undefined || d.schoolId === schoolId,
      );
    },
    schoolOf: (id) => schools.get(id),

    createSchool({
      userId,
      name,
      slug,
      timezone,
    }): Promise<CreateSchoolOutcome> {
      const existingId = owners.get(userId);
      const existing = existingId ? schools.get(existingId) : undefined;
      if (existing) {
        return Promise.resolve({
          status: "exists",
          school: toSummary(existing),
        });
      }
      if ([...schools.values()].some((s) => s.slug === slug)) {
        return Promise.resolve({ status: "slug-taken" });
      }
      const id = `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;
      const school: FakeSchool = {
        id,
        name,
        slug,
        timezone,
        resetHour: 20,
        resetDays: [0, 1, 2, 3, 4, 5, 6],
        announceCode: null,
        displayCode: null,
        failedAttempts: 0,
        windowStartedAt: null,
        lockedUntil: null,
        ipRows: new Map(),
      };
      schools.set(id, school);
      owners.set(userId, id);
      return Promise.resolve({ status: "created", school: toSummary(school) });
    },

    updateSettings(schoolId, patch: SettingsPatch) {
      const school = schools.get(schoolId);
      if (!school) return Promise.resolve(null);
      Object.assign(school, patch);
      return Promise.resolve({
        ...toSummary(school),
        resetHour: school.resetHour,
        resetDays: school.resetDays,
      });
    },

    getCodes(schoolId) {
      const s = schools.get(schoolId);
      return Promise.resolve({
        announceCode: s?.announceCode ?? null,
        displayCode: s?.displayCode ?? null,
      });
    },

    setCode(schoolId, which: CodeTarget, code, disconnect) {
      const s = schools.get(schoolId);
      if (!s) return Promise.reject(new Error("school not found"));
      if (which !== "display") s.announceCode = code;
      if (which !== "announce") s.displayCode = code;
      s.failedAttempts = 0;
      s.windowStartedAt = null;
      s.lockedUntil = null;
      s.ipRows.clear();

      const disconnectedUserIds: string[] = [];
      if (disconnect) {
        for (const [id, d] of deviceRows) {
          const holds =
            (which !== "display" && d.canAnnounce) ||
            (which !== "announce" && d.canDisplay);
          if (d.schoolId === schoolId && holds) {
            disconnectedUserIds.push(d.userId);
            deviceRows.delete(id);
          }
        }
      }
      return Promise.resolve({
        announceCode: s.announceCode,
        displayCode: s.displayCode,
        disconnectedUserIds,
      });
    },

    listDevices(schoolId) {
      return Promise.resolve(
        [...deviceRows.values()]
          .filter((d) => d.schoolId === schoolId)
          .map((d) => ({
            id: d.id,
            label: d.label,
            canAnnounce: d.canAnnounce,
            canDisplay: d.canDisplay,
            createdAt: d.createdAt,
            lastSeenAt: d.lastSeenAt,
          })),
      );
    },

    removeDevice(schoolId, deviceRowId) {
      const d = deviceRows.get(deviceRowId);
      if (!d || d.schoolId !== schoolId) return Promise.resolve(null);
      deviceRows.delete(deviceRowId);
      return Promise.resolve(d.userId);
    },

    attemptPairing(input: AttemptPairingInput) {
      // Synchronous from the first line to the return: like the database's row
      // lock, this makes a burst of parallel attempts count one at a time.
      calls.attemptPairing++;
      const refused: AttemptPairingOutcome = { status: "refused" };
      const school = [...schools.values()].find(
        (row) => row.slug === input.schoolSlug,
      );
      if (!school) return Promise.resolve(refused);

      const MIN = 60_000;
      if (school.lockedUntil !== null && school.lockedUntil > clock) {
        return Promise.resolve<AttemptPairingOutcome>({
          status: "locked",
          lockedUntil: new Date(school.lockedUntil).toISOString(),
        });
      }

      for (const [ip, row] of school.ipRows) {
        if (row.windowStartedAt < clock - 24 * 60 * MIN)
          school.ipRows.delete(ip);
      }
      let ip = school.ipRows.get(input.clientIp);
      if (!ip) {
        ip = { attempts: 0, windowStartedAt: clock, lockedUntil: null };
        school.ipRows.set(input.clientIp, ip);
      }
      if (clock - ip.windowStartedAt > 10 * MIN) {
        ip.attempts = 0;
        ip.windowStartedAt = clock;
        if (ip.lockedUntil !== null && ip.lockedUntil <= clock) {
          ip.lockedUntil = null;
        }
      }
      if (ip.lockedUntil !== null && ip.lockedUntil > clock) {
        return Promise.resolve<AttemptPairingOutcome>({
          status: "locked",
          lockedUntil: new Date(ip.lockedUntil).toISOString(),
        });
      }

      const matches = (stored: string | null) =>
        stored !== null && stored !== "" && stored === input.code;
      const canAnnounce = matches(school.announceCode);
      const canDisplay = matches(school.displayCode);

      if (!canAnnounce && !canDisplay) {
        ip.attempts += 1;
        if (ip.attempts >= 10) ip.lockedUntil = clock + 15 * MIN;
        if (
          school.windowStartedAt === null ||
          clock - school.windowStartedAt > 60 * MIN
        ) {
          school.failedAttempts = 1;
          school.windowStartedAt = clock;
        } else {
          school.failedAttempts += 1;
        }
        if (school.failedAttempts >= 100) school.lockedUntil = clock + 15 * MIN;
        return Promise.resolve(refused);
      }

      const existing = [...deviceRows.values()].find(
        (d) => d.userId === input.userId,
      );
      if (existing && existing.schoolId === school.id) {
        existing.canAnnounce ||= canAnnounce;
        existing.canDisplay ||= canDisplay;
        existing.label = input.label ?? existing.label;
        existing.lastSeenAt = new Date(clock).toISOString();
      } else {
        if (existing) deviceRows.delete(existing.id);
        const id = `device-row-${nextId++}`;
        deviceRows.set(id, {
          id,
          schoolId: school.id,
          userId: input.userId,
          canAnnounce,
          canDisplay,
          label: input.label,
          createdAt: new Date(clock).toISOString(),
          lastSeenAt: new Date(clock).toISOString(),
        });
      }
      return Promise.resolve<AttemptPairingOutcome>({
        status: "paired",
        school: { id: school.id, name: school.name, slug: school.slug },
        canAnnounce,
        canDisplay,
      });
    },

    deleteDeviceUsers(userIds) {
      if (failDelete) return Promise.reject(new Error("auth admin down"));
      let count = 0;
      for (const id of userIds) {
        // The same rule the real store enforces: never an office account.
        if (!anonymous.has(id)) continue;
        deletedUserIds.push(id);
        count++;
      }
      return Promise.resolve(count);
    },
  };
}
