/**
 * An in-memory VoiceUsageStore for handler tests, with the same decisions as
 * the SQL (disabled first, then the cap, then count). A school nobody
 * configured has voice on and no cap, so tests that are not about metering
 * need no setup.
 */

import type {
  VoiceClaim,
  VoiceUsage,
  VoiceUsageStore,
} from "../usage-ports.ts";

export interface FakeUsageStore extends VoiceUsageStore {
  configure(schoolId: string, usage: Partial<VoiceUsage>): void;
  /** Every school id a claim was made for, in order. */
  readonly claims: readonly string[];
  /** Makes every later claim and read throw, like an unreachable database. */
  failWith(error: Error): void;
}

export function createFakeUsage(): FakeUsageStore {
  const bySchool = new Map<string, VoiceUsage>();
  const claims: string[] = [];
  let failure: Error | null = null;

  const get = (schoolId: string): VoiceUsage => {
    let usage = bySchool.get(schoolId);
    if (!usage) {
      usage = { used: 0, limit: null, enabled: true };
      bySchool.set(schoolId, usage);
    }
    return usage;
  };

  return {
    claims,
    configure(schoolId, patch) {
      Object.assign(get(schoolId), patch);
    },
    failWith(error) {
      failure = error;
    },
    claimVoiceSession(schoolId): Promise<VoiceClaim> {
      claims.push(schoolId);
      if (failure) return Promise.reject(failure);
      const usage = get(schoolId);
      if (!usage.enabled) {
        return Promise.resolve({ allowed: false, reason: "disabled" });
      }
      if (usage.limit !== null && usage.used >= usage.limit) {
        return Promise.resolve({ allowed: false, reason: "limit" });
      }
      usage.used += 1;
      return Promise.resolve({
        allowed: true,
        used: usage.used,
        limit: usage.limit,
      });
    },
    voiceUsage(schoolId): Promise<VoiceUsage> {
      if (failure) return Promise.reject(failure);
      return Promise.resolve({ ...get(schoolId) });
    },
  };
}
