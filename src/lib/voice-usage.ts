/**
 * The one sentence the office sees about its school's voice use this month.
 *
 * Every school shares one speech-to-text account, so each has a monthly limit.
 * Reaching it never stops pickup: the curb screen falls back to typing a name,
 * and the sentence says so, because "used up" on its own reads as "broken".
 */

export interface VoiceUsage {
  /** Voice sessions started this calendar month. */
  used: number;
  /** Null means no limit. */
  limit: number | null;
  enabled: boolean;
}

const count = new Intl.NumberFormat("en-US");

/**
 * "Sessions", not "announcements": one session is opened when the microphone
 * is first used and covers several names, so the count is lower than the
 * number of children called by voice. The month is the calendar month in UTC.
 */
function sessions(n: number): string {
  return `${count.format(n)} voice ${n === 1 ? "session" : "sessions"}`;
}

export function voiceUsageSentence(usage: VoiceUsage): string {
  if (!usage.enabled) {
    return "Voice is turned off for this school. Typing a name still works.";
  }
  if (usage.limit === null) {
    return `${sessions(usage.used)} this month. No monthly limit.`;
  }
  if (usage.used >= usage.limit) {
    return `All ${sessions(usage.limit)} for this month are used. Typing a name still works.`;
  }
  return `${count.format(usage.used)} of ${sessions(usage.limit)} used this month.`;
}
