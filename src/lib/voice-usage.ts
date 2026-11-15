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

function announcements(n: number): string {
  return `${count.format(n)} voice ${n === 1 ? "announcement" : "announcements"}`;
}

export function voiceUsageSentence(usage: VoiceUsage): string {
  if (!usage.enabled) {
    return "Voice is turned off for this school. Typing a name still works.";
  }
  if (usage.limit === null) {
    return `${announcements(usage.used)} this month. No monthly limit.`;
  }
  if (usage.used >= usage.limit) {
    return `All ${announcements(usage.limit)} for this month are used. Typing a name still works.`;
  }
  return `${count.format(usage.used)} of ${announcements(usage.limit)} used this month.`;
}
