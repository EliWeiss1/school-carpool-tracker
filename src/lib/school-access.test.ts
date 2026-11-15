import { describe, expect, it } from "vitest";

import {
  cleanDeviceLabel,
  decideAccess,
  gateNotice,
  LAST_SCHOOL_KEY,
  normalizeCode,
  officeLoginHref,
  readLastSchool,
  rememberLastSchool,
  type ScreenNeed,
  type SlugStorage,
  validateCode,
} from "./school-access";

const NEEDS: ScreenNeed[] = ["announce", "display", "office", "hub"];
const DEVICES = [
  null,
  { canAnnounce: false, canDisplay: false },
  { canAnnounce: true, canDisplay: false },
  { canAnnounce: false, canDisplay: true },
  { canAnnounce: true, canDisplay: true },
];

describe("decideAccess", () => {
  it("lets an office account into every screen with no code, device or not", () => {
    for (const need of NEEDS) {
      for (const device of DEVICES) {
        expect(decideAccess({ isOffice: true, device }, need)).toEqual({
          kind: "office",
        });
      }
    }
  });

  it("never lets a device into an office screen", () => {
    for (const device of DEVICES) {
      expect(decideAccess({ isOffice: false, device }, "office")).toEqual({
        kind: "needs-office-login",
      });
    }
  });

  it("asks for a code when there is no device row", () => {
    for (const need of ["announce", "display", "hub"] as const) {
      expect(decideAccess({ isOffice: false, device: null }, need)).toEqual({
        kind: "needs-code",
        reason: "not-connected",
      });
    }
  });

  it("treats a row with no capability as not connected", () => {
    const device = { canAnnounce: false, canDisplay: false };
    expect(decideAccess({ isOffice: false, device }, "hub")).toEqual({
      kind: "needs-code",
      reason: "not-connected",
    });
  });

  it("opens announce only for an announce device, and display only for a board", () => {
    const announce = { canAnnounce: true, canDisplay: false };
    const board = { canAnnounce: false, canDisplay: true };
    const both = { canAnnounce: true, canDisplay: true };

    expect(
      decideAccess({ isOffice: false, device: announce }, "announce"),
    ).toEqual({ kind: "device", canAnnounce: true, canDisplay: false });
    expect(
      decideAccess({ isOffice: false, device: board }, "announce"),
    ).toEqual({ kind: "needs-code", reason: "wrong-capability" });
    expect(
      decideAccess({ isOffice: false, device: announce }, "display"),
    ).toEqual({ kind: "needs-code", reason: "wrong-capability" });
    expect(decideAccess({ isOffice: false, device: board }, "display")).toEqual(
      { kind: "device", canAnnounce: false, canDisplay: true },
    );
    expect(
      decideAccess({ isOffice: false, device: both }, "announce").kind,
    ).toBe("device");
    expect(
      decideAccess({ isOffice: false, device: both }, "display").kind,
    ).toBe("device");
  });

  it("opens the hub for any capable device and reports what it can do", () => {
    expect(
      decideAccess(
        { isOffice: false, device: { canAnnounce: false, canDisplay: true } },
        "hub",
      ),
    ).toEqual({ kind: "device", canAnnounce: false, canDisplay: true });
  });
});

describe("gateNotice", () => {
  it("says nothing when the device simply is not connected", () => {
    expect(gateNotice("announce", "not-connected")).toBeNull();
  });

  it("names the code to enter for each wrong-capability case", () => {
    expect(gateNotice("announce", "wrong-capability")).toBe(
      "This device is connected for the board. Enter the announce code to use it at the curb.",
    );
    expect(gateNotice("display", "wrong-capability")).toContain("board code");
  });
});

describe("code field helpers", () => {
  it("normalizes case, spaces and dashes like the server", () => {
    expect(normalizeCode(" abc-12 3 ")).toBe("ABC123");
  });

  it("validates length and characters", () => {
    expect(validateCode("")).toMatch(/Enter/);
    expect(validateCode("ab12")).toMatch(/6 to 20/);
    expect(validateCode("abc!23")).toMatch(/letters and numbers/);
    expect(validateCode("a".repeat(21))).toMatch(/6 to 20/);
    expect(validateCode("abc-123")).toBeNull();
    expect(validateCode("A".repeat(20))).toBeNull();
  });

  it("trims and caps the device name, dropping a blank one", () => {
    expect(cleanDeviceLabel("   ")).toBeUndefined();
    expect(cleanDeviceLabel(" Front gate ")).toBe("Front gate");
    expect(cleanDeviceLabel("x".repeat(80))).toHaveLength(60);
  });
});

describe("officeLoginHref", () => {
  it("encodes the way back", () => {
    expect(officeLoginHref("/s/oak-hill/admin")).toBe(
      "/login?next=%2Fs%2Foak-hill%2Fadmin",
    );
  });
});

function memoryStorage(initial: Record<string, string> = {}): SlugStorage & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe("last school memory", () => {
  it("round-trips a valid slug", () => {
    const storage = memoryStorage();
    rememberLastSchool(storage, "oak-hill");
    expect(storage.data[LAST_SCHOOL_KEY]).toBe("oak-hill");
    expect(readLastSchool(storage)).toBe("oak-hill");
  });

  it("refuses to store or return something that is not a slug", () => {
    const storage = memoryStorage();
    rememberLastSchool(storage, "../evil");
    expect(storage.data).toEqual({});
    // A tampered value must never become a redirect target.
    expect(
      readLastSchool(memoryStorage({ [LAST_SCHOOL_KEY]: "//evil.com" })),
    ).toBeNull();
  });

  it("survives missing or throwing storage", () => {
    const throwing: SlugStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => rememberLastSchool(throwing, "oak-hill")).not.toThrow();
    expect(readLastSchool(throwing)).toBeNull();
    expect(readLastSchool(null)).toBeNull();
  });
});
