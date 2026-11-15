import { describe, expect, it } from "vitest";

import {
  buildSettingsPayload,
  formFromRow,
  hourLabel,
  isDirty,
  resetDaysSummary,
  toggleDay,
  validateSettings,
} from "./school-settings-form";

const saved = formFromRow({
  name: "Beth Jacob",
  timezone: "America/New_York",
  reset_hour: 20,
  reset_days: [4, 0, 1],
});

describe("hourLabel", () => {
  it("uses 12-hour labels", () => {
    expect(hourLabel(0)).toBe("12:00 AM");
    expect(hourLabel(9)).toBe("9:00 AM");
    expect(hourLabel(12)).toBe("12:00 PM");
    expect(hourLabel(20)).toBe("8:00 PM");
    expect(hourLabel(23)).toBe("11:00 PM");
  });
});

describe("toggleDay", () => {
  it("adds in order and removes", () => {
    expect(toggleDay([0, 4], 2)).toEqual([0, 2, 4]);
    expect(toggleDay([0, 2, 4], 2)).toEqual([0, 4]);
  });
});

describe("dirty check and payload", () => {
  it("starts clean and sorts the saved days", () => {
    expect(saved.resetDays).toEqual([0, 1, 4]);
    expect(isDirty(saved, { ...saved })).toBe(false);
  });
  it("ignores edge spaces in the name and day order", () => {
    expect(
      isDirty(saved, { ...saved, name: " Beth Jacob ", resetDays: [1, 4, 0] }),
    ).toBe(false);
  });
  it("sends only the changed fields", () => {
    const current = { ...saved, resetHour: 21, name: "Beth Jacob School " };
    expect(buildSettingsPayload(saved, current)).toEqual({
      name: "Beth Jacob School",
      resetHour: 21,
    });
  });
  it("sends an empty day list when all are switched off", () => {
    expect(buildSettingsPayload(saved, { ...saved, resetDays: [] })).toEqual({
      resetDays: [],
    });
  });
  it("sends nothing when nothing changed", () => {
    expect(buildSettingsPayload(saved, saved)).toEqual({});
  });
});

describe("validation and summary", () => {
  it("requires a name", () => {
    expect(validateSettings({ ...saved, name: "  " })).not.toBeNull();
    expect(validateSettings(saved)).toBeNull();
  });
  it("explains no days, every day, and some days", () => {
    expect(resetDaysSummary([])).toMatch(/never resets by itself/);
    expect(resetDaysSummary([0, 1, 2, 3, 4, 5, 6])).toMatch(/every evening/);
    expect(resetDaysSummary([4, 0])).toBe(
      "The board resets on Sunday, Thursday evenings.",
    );
  });
});
