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
  PairDeviceInput,
  PairingTarget,
  SchoolCodes,
  SchoolSettings,
  SchoolStore,
  SettingsPatch,
} from "../school-ports.ts";

interface FakeSchool extends SchoolSettings {
  announceCode: string | null;
  displayCode: string | null;
  failedAttempts: number;
  windowStartedAt: number | null;
  lockedUntil: number | null;
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
  readonly calls: { notePairFailure: number; pairDevice: number };
}

export function createFakeSchoolStore(startMs = 0): FakeSchoolStore {
  let clock = startMs;
  const schools = new Map<string, FakeSchool>();
  const owners = new Map<string, string>();
  const deviceRows = new Map<string, FakeDevice>();
  const anonymous = new Set<string>();
  const deletedUserIds: string[] = [];
  const calls = { notePairFailure: 0, pairDevice: 0 };
  let failDelete = false;
  let nextId = 1;

  const toSummary = (s: FakeSchool) => ({
    id: s.id,
    name: s.name,
    slug: s.slug,
    timezone: s.timezone,
  });
  const iso = (ms: number | null) =>
    ms === null ? null : new Date(ms).toISOString();

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

    findSchoolForPairing(slug): Promise<PairingTarget | null> {
      const s = [...schools.values()].find((row) => row.slug === slug);
      if (!s) return Promise.resolve(null);
      return Promise.resolve({
        id: s.id,
        name: s.name,
        slug: s.slug,
        announceCode: s.announceCode,
        displayCode: s.displayCode,
        lockedUntil: iso(s.lockedUntil),
      });
    },

    notePairFailure(schoolId) {
      calls.notePairFailure++;
      const s = schools.get(schoolId);
      if (!s) return Promise.resolve({ failedAttempts: 0, lockedUntil: null });
      const WINDOW = 10 * 60_000;
      if (s.windowStartedAt === null || clock - s.windowStartedAt > WINDOW) {
        s.failedAttempts = 1;
        s.windowStartedAt = clock;
      } else {
        s.failedAttempts += 1;
      }
      if (s.failedAttempts >= 10) s.lockedUntil = clock + 15 * 60_000;
      return Promise.resolve({
        failedAttempts: s.failedAttempts,
        lockedUntil: iso(s.lockedUntil),
      });
    },

    pairDevice(input: PairDeviceInput) {
      calls.pairDevice++;
      const existing = [...deviceRows.values()].find(
        (d) => d.userId === input.userId,
      );
      if (existing && existing.schoolId === input.schoolId) {
        existing.canAnnounce ||= input.canAnnounce;
        existing.canDisplay ||= input.canDisplay;
        existing.label = input.label ?? existing.label;
        existing.lastSeenAt = new Date(clock).toISOString();
      } else {
        if (existing) deviceRows.delete(existing.id);
        const id = `device-row-${nextId++}`;
        deviceRows.set(id, {
          id,
          schoolId: input.schoolId,
          userId: input.userId,
          canAnnounce: input.canAnnounce,
          canDisplay: input.canDisplay,
          label: input.label,
          createdAt: new Date(clock).toISOString(),
          lastSeenAt: new Date(clock).toISOString(),
        });
      }
      return Promise.resolve();
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
