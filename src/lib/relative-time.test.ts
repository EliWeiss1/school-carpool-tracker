import { describe, expect, it } from "vitest";

import { lastSeenLabel, relativeTime } from "./relative-time";

const now = new Date("2026-11-14T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

describe("relativeTime", () => {
  it("says just now under a minute", () => {
    expect(relativeTime(ago(20_000), now)).toBe("Just now");
  });
  it("counts minutes, hours and days with plurals", () => {
    expect(relativeTime(ago(60_000), now)).toBe("1 minute ago");
    expect(relativeTime(ago(5 * 60_000), now)).toBe("5 minutes ago");
    expect(relativeTime(ago(3_600_000), now)).toBe("1 hour ago");
    expect(relativeTime(ago(3 * 3_600_000), now)).toBe("3 hours ago");
    expect(relativeTime(ago(86_400_000), now)).toBe("1 day ago");
    expect(relativeTime(ago(9 * 86_400_000), now)).toBe("9 days ago");
  });
  it("treats a time slightly in the future as just now", () => {
    expect(relativeTime(ago(-5000), now)).toBe("Just now");
  });
  it("does not throw on junk", () => {
    expect(relativeTime("nope", now)).toBe("Unknown");
  });
});

describe("lastSeenLabel", () => {
  it("handles a device never seen", () => {
    expect(lastSeenLabel(null, now)).toBe("Not seen yet");
  });
});
