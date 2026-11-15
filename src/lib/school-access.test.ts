import { describe, expect, it } from "vitest";

import {
  cleanDeviceLabel,
  decideAccess,
  decideRecheck,
  gateNotice,
  LAST_SCHOOL_KEY,
  normalizeCode,
  officeLoginHref,
  readLastSchool,
  rememberLastSchool,
  sameAccess,
  type ScreenNeed,
  type SlugStorage,
  validateCode,
} from "./school-access";

type Dev = { canAnnounce: boolean; canDisplay: boolean } | null;
const NONE: Dev = null;
const ANN: Dev = { canAnnounce: true, canDisplay: false };
const DIS: Dev = { canAnnounce: false, canDisplay: true };
const BOTH: Dev = { canAnnounce: true, canDisplay: true };

const device = (d: NonNullable<Dev>) => ({
  kind: "device" as const,
  canAnnounce: d.canAnnounce,
  canDisplay: d.canDisplay,
});
const code = (reason: "not-connected" | "wrong-capability") => ({
  kind: "needs-code" as const,
  reason,
});
const OFFICE = { kind: "office" as const };
const LOGIN = { kind: "needs-office-login" as const };

describe("decideAccess: need x live office session x device access", () => {
  // [need, isOffice, device, expected]. A device that already has what the
  // screen needs wins over an office login, so an office sign-out in the same
  // browser can never knock a board off; office is only the fallback.
  const table: Array<[ScreenNeed, boolean, Dev, unknown]> = [
    ["announce", false, NONE, code("not-connected")],
    ["announce", false, ANN, device(ANN!)],
    ["announce", false, DIS, code("wrong-capability")],
    ["announce", false, BOTH, device(BOTH!)],
    ["announce", true, NONE, OFFICE],
    ["announce", true, ANN, device(ANN!)],
    ["announce", true, DIS, OFFICE],
    ["announce", true, BOTH, device(BOTH!)],

    ["display", false, NONE, code("not-connected")],
    ["display", false, ANN, code("wrong-capability")],
    ["display", false, DIS, device(DIS!)],
    ["display", false, BOTH, device(BOTH!)],
    ["display", true, NONE, OFFICE],
    ["display", true, ANN, OFFICE],
    ["display", true, DIS, device(DIS!)],
    ["display", true, BOTH, device(BOTH!)],

    ["hub", false, NONE, code("not-connected")],
    ["hub", false, ANN, device(ANN!)],
    ["hub", false, DIS, device(DIS!)],
    ["hub", false, BOTH, device(BOTH!)],
    ["hub", true, NONE, OFFICE],
    ["hub", true, ANN, device(ANN!)],
    ["hub", true, DIS, device(DIS!)],
    ["hub", true, BOTH, device(BOTH!)],

    // Office screens never accept a device, however it was paired.
    ["office", false, NONE, LOGIN],
    ["office", false, ANN, LOGIN],
    ["office", false, DIS, LOGIN],
    ["office", false, BOTH, LOGIN],
    ["office", true, NONE, OFFICE],
    ["office", true, ANN, OFFICE],
    ["office", true, DIS, OFFICE],
    ["office", true, BOTH, OFFICE],
  ];

  it.each(table)(
    "%s, office=%s, device=%j",
    (need, isOffice, dev, expected) => {
      expect(decideAccess({ isOffice, device: dev }, need)).toEqual(expected);
    },
  );

  it("treats a row with no capability as not connected", () => {
    expect(
      decideAccess(
        { isOffice: false, device: { canAnnounce: false, canDisplay: false } },
        "hub",
      ),
    ).toEqual(code("not-connected"));
  });
});

describe("decideRecheck", () => {
  const cur = { canAnnounce: true, canDisplay: false };

  it("keeps everything when the lookup failed", () => {
    expect(decideRecheck("announce", cur, { ok: false })).toEqual({
      action: "keep",
    });
  });

  it("keeps (no re-render) when nothing changed", () => {
    expect(
      decideRecheck("announce", cur, { ok: true, device: { ...cur } }),
    ).toEqual({ action: "keep" });
  });

  it("shows the code prompt when the row is gone", () => {
    expect(decideRecheck("display", cur, { ok: true, device: null })).toEqual({
      action: "show-code",
      reason: "not-connected",
    });
  });

  it("shows the code prompt when the needed capability is gone", () => {
    expect(
      decideRecheck("announce", cur, {
        ok: true,
        device: { canAnnounce: false, canDisplay: true },
      }),
    ).toEqual({ action: "show-code", reason: "wrong-capability" });
  });

  it("keeps the screen but updates the hub when it gains a capability", () => {
    expect(
      decideRecheck("hub", cur, {
        ok: true,
        device: { canAnnounce: true, canDisplay: true },
      }),
    ).toEqual({ action: "update", canAnnounce: true, canDisplay: true });
  });

  it("does not drop a screen that lost only an unrelated capability", () => {
    expect(
      decideRecheck(
        "announce",
        { canAnnounce: true, canDisplay: true },
        {
          ok: true,
          device: { canAnnounce: true, canDisplay: false },
        },
      ),
    ).toEqual({ action: "update", canAnnounce: true, canDisplay: false });
  });
});

describe("sameAccess", () => {
  const a = {
    kind: "device" as const,
    schoolId: "s1",
    canAnnounce: true,
    canDisplay: false,
  };
  it("is true only when kind, school and capabilities all match", () => {
    expect(sameAccess(a, { ...a })).toBe(true);
    expect(sameAccess(a, { ...a, kind: "office" })).toBe(false);
    expect(sameAccess(a, { ...a, schoolId: "s2" })).toBe(false);
    expect(sameAccess(a, { ...a, canDisplay: true })).toBe(false);
    expect(sameAccess(a, { ...a, canAnnounce: false })).toBe(false);
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
