/**
 * What the handlers need to meter paid voice sessions.
 *
 * Separate from `RosterStore` on purpose: these calls name the school
 * explicitly (the id the guard returned) and are not roster queries, so they
 * live outside the school-scoped store helpers. The numbers and the cap are
 * the database's (claim_voice_session, school_voice_usage); a handler only
 * ever hands in a school id the guard has already checked.
 */

export type VoiceClaim =
  | { allowed: true; used: number; limit: number | null }
  | { allowed: false; reason: "disabled" | "limit" };

export interface VoiceUsage {
  used: number;
  /** null means the school has no monthly cap. */
  limit: number | null;
  enabled: boolean;
}

export interface VoiceUsageStore {
  /**
   * Counts one voice session against the school's month, atomically, or says
   * why not. Throws if the counter cannot be reached: callers must treat that
   * as "no session", never as "unlimited".
   */
  claimVoiceSession(schoolId: string): Promise<VoiceClaim>;

  /** This month's numbers, for the office screen. Counts nothing. */
  voiceUsage(schoolId: string): Promise<VoiceUsage>;
}
