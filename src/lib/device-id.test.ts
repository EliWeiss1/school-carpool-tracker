import { describe, expect, it } from "vitest";

import { deviceId } from "./device-id";

describe("device id", () => {
  it("is stable for the life of the module", () => {
    expect(deviceId()).toBe(deviceId());
  });

  it("is a non-empty string", () => {
    expect(deviceId().length).toBeGreaterThan(8);
  });
});
