import { describe, expect, it } from "vitest";

import {
  deviceCodeMatches,
  isValidDeviceCode,
  normalizeDeviceCode,
} from "./device-code.ts";

describe("normalizeDeviceCode", () => {
  it("trims, uppercases and drops spaces and dashes", () => {
    expect(normalizeDeviceCode("  ab-c 12 3 ")).toBe("ABC123");
    expect(normalizeDeviceCode("abc123")).toBe("ABC123");
  });
});

describe("isValidDeviceCode", () => {
  it("accepts 6 to 20 letters and digits after normalising", () => {
    expect(isValidDeviceCode("ab-c123")).toBe(true);
    expect(isValidDeviceCode("A".repeat(20))).toBe(true);
  });
  it("refuses short, long and punctuated codes", () => {
    expect(isValidDeviceCode("abc12")).toBe(false);
    expect(isValidDeviceCode("A".repeat(21))).toBe(false);
    expect(isValidDeviceCode("abc123!")).toBe(false);
    expect(isValidDeviceCode("")).toBe(false);
  });
  it("refuses non-strings", () => {
    expect(isValidDeviceCode(123456)).toBe(false);
  });
});

describe("deviceCodeMatches", () => {
  it("matches the same code however it was typed", async () => {
    expect(await deviceCodeMatches("abc-123", "ABC123")).toBe(true);
  });
  it("rejects a different code", async () => {
    expect(await deviceCodeMatches("ABC124", "ABC123")).toBe(false);
  });
  it("is false when nothing is stored", async () => {
    expect(await deviceCodeMatches("ABC123", null)).toBe(false);
    expect(await deviceCodeMatches("ABC123", "")).toBe(false);
  });
  it("is false for an empty candidate", async () => {
    expect(await deviceCodeMatches("", "ABC123")).toBe(false);
    expect(await deviceCodeMatches("", "")).toBe(false);
  });
});
