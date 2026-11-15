/**
 * The school settings form: its values, its dirty check, and the request it
 * sends. Days are numbered 0 = Sunday, the same as the database.
 */

import type { UpdateSettingsInput } from "@/lib/school-api";

export interface SettingsForm {
  name: string;
  timezone: string;
  resetHour: number;
  resetDays: number[];
}

/** The columns the page reads from `schools`. */
export interface SettingsRow {
  name: string;
  timezone: string;
  reset_hour: number;
  reset_days: number[];
}

export type SettingsPayload = Pick<
  UpdateSettingsInput,
  "name" | "timezone" | "resetHour" | "resetDays"
>;

export const DAYS: readonly { value: number; short: string; long: string }[] = [
  { value: 0, short: "Sun", long: "Sunday" },
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" },
];

export const HOURS: readonly number[] = Array.from({ length: 24 }, (_, i) => i);

/** 0 is "12:00 AM", 12 is "12:00 PM", 20 is "8:00 PM". */
export function hourLabel(hour: number): string {
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:00 ${hour < 12 ? "AM" : "PM"}`;
}

function sortedUnique(days: readonly number[]): number[] {
  return [...new Set(days)].sort((a, b) => a - b);
}

/** Turn one day on or off, keeping the set sorted and free of repeats. */
export function toggleDay(days: readonly number[], day: number): number[] {
  return days.includes(day)
    ? days.filter((d) => d !== day)
    : sortedUnique([...days, day]);
}

export function formFromRow(row: SettingsRow): SettingsForm {
  return {
    name: row.name,
    timezone: row.timezone,
    resetHour: row.reset_hour,
    resetDays: sortedUnique(row.reset_days),
  };
}

function sameDays(a: readonly number[], b: readonly number[]): boolean {
  const left = sortedUnique(a);
  const right = sortedUnique(b);
  return left.length === right.length && left.every((d, i) => d === right[i]);
}

/** Fields that differ. A name that only differs by edge spaces is unchanged. */
export function changedFields(
  saved: SettingsForm,
  current: SettingsForm,
): Array<keyof SettingsForm> {
  const changed: Array<keyof SettingsForm> = [];
  if (current.name.trim() !== saved.name.trim()) changed.push("name");
  if (current.timezone !== saved.timezone) changed.push("timezone");
  if (current.resetHour !== saved.resetHour) changed.push("resetHour");
  if (!sameDays(current.resetDays, saved.resetDays)) changed.push("resetDays");
  return changed;
}

export function isDirty(saved: SettingsForm, current: SettingsForm): boolean {
  return changedFields(saved, current).length > 0;
}

/** Null when the form can be saved, else the sentence to show. */
export function validateSettings(current: SettingsForm): string | null {
  return current.name.trim() === "" ? "Enter your school's name." : null;
}

/** Only what changed, so a save never overwrites a field it did not touch. */
export function buildSettingsPayload(
  saved: SettingsForm,
  current: SettingsForm,
): SettingsPayload {
  const payload: SettingsPayload = {};
  for (const field of changedFields(saved, current)) {
    if (field === "name") payload.name = current.name.trim();
    if (field === "timezone") payload.timezone = current.timezone;
    if (field === "resetHour") payload.resetHour = current.resetHour;
    if (field === "resetDays") {
      payload.resetDays = sortedUnique(current.resetDays);
    }
  }
  return payload;
}

/** The sentence under the day toggles. */
export function resetDaysSummary(days: readonly number[]): string {
  if (days.length === 0) {
    return "No evenings selected, so the board never resets by itself. Use Reset the board when you want it cleared.";
  }
  if (days.length === 7) return "The board resets every evening.";
  const names = sortedUnique(days).map((d) => DAYS[d].long);
  return `The board resets on ${names.join(", ")} evenings.`;
}
