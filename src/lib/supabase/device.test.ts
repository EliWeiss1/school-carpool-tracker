import { describe, expect, it, vi } from "vitest";

import {
  ensureDeviceSession,
  getDeviceAccessToken,
  pairDevice,
  type DeviceAuth,
} from "./device";

function fakeAuth(session: string | null, signInToken: string | null = "anon") {
  const signInAnonymously = vi.fn().mockResolvedValue(
    signInToken
      ? {
          data: { session: { access_token: signInToken } },
          error: null,
        }
      : { data: { session: null }, error: { message: "nope" } },
  );
  const auth: DeviceAuth = {
    getSession: vi.fn().mockResolvedValue({
      data: { session: session ? { access_token: session } : null },
    }),
    signInAnonymously,
  };
  return { auth, signInAnonymously };
}

describe("device session helpers", () => {
  it("reads the current token, or null with no session", async () => {
    expect(await getDeviceAccessToken(fakeAuth("tok").auth)).toBe("tok");
    expect(await getDeviceAccessToken(fakeAuth(null).auth)).toBeNull();
  });

  it("reuses an existing session without signing in again", async () => {
    const { auth, signInAnonymously } = fakeAuth("tok");
    expect(await ensureDeviceSession(auth)).toBe("tok");
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it("signs in anonymously when there is no session", async () => {
    const { auth, signInAnonymously } = fakeAuth(null, "anon-token");
    expect(await ensureDeviceSession(auth)).toBe("anon-token");
    expect(signInAnonymously).toHaveBeenCalledOnce();
  });

  it("throws a sentence when anonymous sign-in fails", async () => {
    await expect(
      ensureDeviceSession(fakeAuth(null, null).auth),
    ).rejects.toThrow(/could not set this device up/i);
  });
});

describe("pairDevice", () => {
  it("pairs with the device token and this browser's device id", async () => {
    const { auth } = fakeAuth(null, "anon-token");
    const api = {
      pairDevice: vi.fn().mockResolvedValue({
        school: { id: "s", name: "Maple", slug: "maple" },
        canAnnounce: true,
        canDisplay: false,
      }),
    };

    const result = await pairDevice(
      { schoolSlug: "maple", code: "1234", label: "Gate" },
      { auth, api, deviceId: "dev-1" },
    );

    expect(result.canAnnounce).toBe(true);
    expect(api.pairDevice).toHaveBeenCalledWith({
      schoolSlug: "maple",
      code: "1234",
      label: "Gate",
      accessToken: "anon-token",
      deviceId: "dev-1",
    });
  });
});
