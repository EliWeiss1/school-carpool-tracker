import { describe, expect, it } from "vitest";

import {
  DISMISS_TTL_MS,
  chooseInstallMode,
  detectPlatform,
  isDismissed,
  parseDismissedAt,
} from "./install-prompt";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const PIXEL =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

describe("detectPlatform", () => {
  it("recognises an iPhone", () => {
    expect(detectPlatform({ userAgent: IPHONE, maxTouchPoints: 5 })).toBe(
      "ios",
    );
  });

  it("recognises an iPad that reports itself as a Mac", () => {
    expect(detectPlatform({ userAgent: IPAD_AS_MAC, maxTouchPoints: 5 })).toBe(
      "ios",
    );
  });

  it("does not mistake a real Mac for an iPad", () => {
    expect(detectPlatform({ userAgent: IPAD_AS_MAC, maxTouchPoints: 0 })).toBe(
      "other",
    );
  });

  it("recognises Android", () => {
    expect(detectPlatform({ userAgent: PIXEL, maxTouchPoints: 5 })).toBe(
      "android",
    );
  });

  it("treats a desktop browser as other", () => {
    expect(detectPlatform({ userAgent: WINDOWS, maxTouchPoints: 0 })).toBe(
      "other",
    );
  });
});

describe("parseDismissedAt", () => {
  it("treats a missing value as never dismissed", () => {
    expect(parseDismissedAt(null)).toBeNull();
  });

  it("parses a stored timestamp", () => {
    expect(parseDismissedAt("1700000000000")).toBe(1700000000000);
  });

  it.each(["", "abc", "NaN", "-5", "0", "Infinity"])(
    "treats %j as never dismissed",
    (raw) => {
      expect(parseDismissedAt(raw)).toBeNull();
    },
  );
});

describe("isDismissed", () => {
  const now = 1_700_000_000_000;

  it("is false when never dismissed", () => {
    expect(isDismissed(null, now)).toBe(false);
  });

  it("is true shortly after a dismissal", () => {
    expect(isDismissed(now - 1000, now)).toBe(true);
  });

  it("expires once the snooze has run out", () => {
    expect(isDismissed(now - DISMISS_TTL_MS, now)).toBe(false);
    expect(isDismissed(now - DISMISS_TTL_MS + 1, now)).toBe(true);
  });

  it("ignores a timestamp from the future", () => {
    expect(isDismissed(now + 60_000, now)).toBe(false);
  });
});

describe("chooseInstallMode", () => {
  const base = {
    platform: "android" as const,
    standalone: false,
    hasNativePrompt: true,
    dismissed: false,
  };

  it("uses the native prompt when the browser supplied one", () => {
    expect(chooseInstallMode(base)).toBe("native");
    expect(chooseInstallMode({ ...base, platform: "ios" })).toBe("native");
  });

  it("falls back to written steps on iOS", () => {
    expect(
      chooseInstallMode({ ...base, platform: "ios", hasNativePrompt: false }),
    ).toBe("ios-steps");
  });

  it("says nothing on Android before the browser offers a prompt", () => {
    expect(chooseInstallMode({ ...base, hasNativePrompt: false })).toBe("none");
  });

  it("stays away once installed", () => {
    expect(chooseInstallMode({ ...base, standalone: true })).toBe("none");
    expect(
      chooseInstallMode({
        ...base,
        platform: "ios",
        hasNativePrompt: false,
        standalone: true,
      }),
    ).toBe("none");
  });

  it("stays away after a dismissal", () => {
    expect(chooseInstallMode({ ...base, dismissed: true })).toBe("none");
  });

  it("stays away on a desktop browser even if it fires the event", () => {
    expect(chooseInstallMode({ ...base, platform: "other" })).toBe("none");
  });
});
