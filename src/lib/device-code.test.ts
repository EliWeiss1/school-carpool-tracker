import { describe, expect, it } from "vitest";

import {
  deviceAbilityLabel,
  deviceCountLabel,
  deviceName,
  devicesDisconnectedBy,
  normalizeDeviceCode,
  validateDeviceCode,
} from "./device-code";
import type { SchoolDeviceInfo } from "./school-api";

const dev = (
  id: string,
  canAnnounce: boolean,
  canDisplay: boolean,
  label: string | null = null,
): SchoolDeviceInfo => ({
  id,
  label,
  canAnnounce,
  canDisplay,
  createdAt: "2026-11-01T00:00:00Z",
  lastSeenAt: null,
});

describe("normalizeDeviceCode", () => {
  it("uppercases and strips spaces and dashes", () => {
    expect(normalizeDeviceCode("  abc-12 3 ")).toBe("ABC123");
  });
});

describe("validateDeviceCode", () => {
  it("accepts 6 to 20 letters and digits", () => {
    expect(validateDeviceCode("abc123")).toBeNull();
    expect(validateDeviceCode("a".repeat(20))).toBeNull();
  });
  it("rejects short, long and symbol codes", () => {
    expect(validateDeviceCode("abc12")).not.toBeNull();
    expect(validateDeviceCode("a".repeat(21))).not.toBeNull();
    expect(validateDeviceCode("abc12!")).not.toBeNull();
    expect(validateDeviceCode("")).not.toBeNull();
  });
  it("counts length after normalising", () => {
    expect(validateDeviceCode("ab-cd ef")).toBeNull();
  });
});

describe("devicesDisconnectedBy", () => {
  const devices = [
    dev("a", true, false),
    dev("d", false, true),
    dev("b", true, true),
  ];
  it("announce takes every device that can announce", () => {
    expect(devicesDisconnectedBy(devices, "announce").map((d) => d.id)).toEqual(
      ["a", "b"],
    );
  });
  it("display takes every device that can show the board", () => {
    expect(devicesDisconnectedBy(devices, "display").map((d) => d.id)).toEqual([
      "d",
      "b",
    ]);
  });
  it("both takes all of them once", () => {
    expect(devicesDisconnectedBy(devices, "both")).toHaveLength(3);
  });
});

describe("labels", () => {
  it("counts with the right plural", () => {
    expect(deviceCountLabel(1)).toBe("1 device");
    expect(deviceCountLabel(0)).toBe("0 devices");
    expect(deviceCountLabel(2)).toBe("2 devices");
  });
  it("names abilities", () => {
    expect(deviceAbilityLabel(dev("a", true, false))).toBe("Announce");
    expect(deviceAbilityLabel(dev("a", false, true))).toBe("Board");
    expect(deviceAbilityLabel(dev("a", true, true))).toBe("Announce and board");
  });
  it("falls back for an unnamed device", () => {
    expect(deviceName(dev("a", true, false, "  "))).toBe("Unnamed device");
    expect(deviceName(dev("a", true, false, "Front gate phone"))).toBe(
      "Front gate phone",
    );
  });
});
