import { describe, expect, it } from "vitest";

import { verifyPin } from "./pin.ts";

describe("verifyPin", () => {
  it("accepts the configured PIN", async () => {
    await expect(verifyPin("4821", "4821")).resolves.toBe(true);
  });

  it("rejects a wrong PIN", async () => {
    await expect(verifyPin("4822", "4821")).resolves.toBe(false);
  });

  it("rejects a PIN of the wrong length without leaking that fact early", async () => {
    await expect(verifyPin("482", "4821")).resolves.toBe(false);
    await expect(verifyPin("48210000", "4821")).resolves.toBe(false);
  });

  it("rejects a missing PIN", async () => {
    await expect(verifyPin(undefined, "4821")).resolves.toBe(false);
    await expect(verifyPin(null, "4821")).resolves.toBe(false);
    await expect(verifyPin("", "4821")).resolves.toBe(false);
  });

  it("fails closed when no PIN is configured", async () => {
    // A missing STAFF_PIN env var is a deployment mistake. Treating it as
    // "no PIN required" would silently open every write path in the app.
    await expect(verifyPin("4821", undefined)).resolves.toBe(false);
    await expect(verifyPin("", undefined)).resolves.toBe(false);
    await expect(verifyPin("4821", "   ")).resolves.toBe(false);
  });

  it("forgives whitespace around a PIN typed on a phone keyboard", async () => {
    await expect(verifyPin(" 4821 ", "4821")).resolves.toBe(true);
  });

  it("compares by value, not by digest collision, for a non-ASCII PIN", async () => {
    await expect(verifyPin("héllo", "héllo")).resolves.toBe(true);
    await expect(verifyPin("hello", "héllo")).resolves.toBe(false);
  });
});
