import { describe, expect, it } from "vitest";

import { defaultTimeZone, timeZoneOptions } from "./time-zones";

describe("timeZoneOptions", () => {
  it("uses the supplied list, sorted, with a readable label", () => {
    const options = timeZoneOptions({
      supported: ["Europe/London", "America/New_York"],
      current: "Europe/London",
    });
    expect(options.map((o) => o.value)).toEqual([
      "America/New_York",
      "Europe/London",
    ]);
    expect(options[0].label).toBe("America / New York");
  });

  it("falls back to a built-in list when the runtime offers none", () => {
    const values = timeZoneOptions({
      supported: undefined,
      current: "UTC",
    }).map((o) => o.value);
    expect(values).toContain("America/Los_Angeles");
    expect(values).toContain("America/New_York");
  });

  it("always includes the current zone, even if the list lacks it", () => {
    const options = timeZoneOptions({
      supported: ["America/New_York"],
      current: "Asia/Jerusalem",
    });
    expect(options.map((o) => o.value)).toContain("Asia/Jerusalem");
  });

  it("does not duplicate the current zone", () => {
    const options = timeZoneOptions({
      supported: ["America/New_York"],
      current: "America/New_York",
    });
    expect(options).toHaveLength(1);
  });
});

describe("defaultTimeZone", () => {
  it("returns the browser's zone", () => {
    expect(defaultTimeZone("America/Chicago")).toBe("America/Chicago");
  });

  it("falls back to Pacific when the browser reports nothing usable", () => {
    expect(defaultTimeZone(undefined)).toBe("America/Los_Angeles");
    expect(defaultTimeZone("")).toBe("America/Los_Angeles");
  });
});
