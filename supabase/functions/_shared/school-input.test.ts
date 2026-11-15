import { describe, expect, it } from "vitest";

import {
  readDeviceLabel,
  readResetDays,
  readResetHour,
  readSchoolName,
  readSlug,
  readTimeZone,
} from "./school-input.ts";

describe("readSchoolName", () => {
  it("trims and accepts 1 to 120 characters", () => {
    expect(readSchoolName("  Maple School ")).toEqual({
      ok: true,
      value: "Maple School",
    });
    expect(readSchoolName("x".repeat(120)).ok).toBe(true);
  });
  it("refuses blank, long and non-string names with one sentence", () => {
    for (const bad of ["   ", "x".repeat(121), 5, undefined]) {
      const result = readSchoolName(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/school name/i);
    }
  });
});

describe("readSlug", () => {
  it("accepts a lowercase web address", () => {
    expect(readSlug("maple-school")).toEqual({
      ok: true,
      value: "maple-school",
    });
    expect(readSlug("abc").ok).toBe(true);
  });
  it("refuses uppercase, edges, spaces, too short and too long", () => {
    const bad = ["Maple", "-maple", "maple-", "a", "ab", "my school", "", 3];
    for (const value of [...bad, "a".repeat(49)]) {
      expect(readSlug(value).ok, String(value)).toBe(false);
    }
  });
});

describe("readTimeZone", () => {
  it("accepts IANA zones", () => {
    expect(readTimeZone("America/Chicago").ok).toBe(true);
    expect(readTimeZone("UTC").ok).toBe(true);
  });
  it("refuses nonsense", () => {
    expect(readTimeZone("Mars/Olympus").ok).toBe(false);
    expect(readTimeZone("").ok).toBe(false);
    expect(readTimeZone(7).ok).toBe(false);
  });
  it("refuses bare UTC offsets, which Postgres reads with the sign inverted", () => {
    for (const bad of ["+05:00", "-08:00", "+0530", "5", "-8"]) {
      expect(readTimeZone(bad).ok, bad).toBe(false);
    }
  });
});

describe("readResetHour", () => {
  it("accepts integers 0 to 23", () => {
    expect(readResetHour(0)).toEqual({ ok: true, value: 0 });
    expect(readResetHour(23).ok).toBe(true);
  });
  it("refuses out of range, fractions and strings", () => {
    for (const bad of [-1, 24, 1.5, "8", null]) {
      expect(readResetHour(bad).ok).toBe(false);
    }
  });
});

describe("readResetDays", () => {
  it("accepts unique days 0 to 6 and an empty list", () => {
    expect(readResetDays([0, 1, 4])).toEqual({ ok: true, value: [0, 1, 4] });
    expect(readResetDays([])).toEqual({ ok: true, value: [] });
  });
  it("refuses duplicates, out of range and non-arrays", () => {
    for (const bad of [[1, 1], [7], [-1], [1.5], ["1"], "1", null]) {
      expect(readResetDays(bad).ok).toBe(false);
    }
  });
});

describe("readDeviceLabel", () => {
  it("is optional and trimmed", () => {
    expect(readDeviceLabel(undefined)).toEqual({ ok: true, value: null });
    expect(readDeviceLabel("  ")).toEqual({ ok: true, value: null });
    expect(readDeviceLabel(" Front door ")).toEqual({
      ok: true,
      value: "Front door",
    });
  });
  it("refuses over 60 characters", () => {
    expect(readDeviceLabel("x".repeat(61)).ok).toBe(false);
  });
});
