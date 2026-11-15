import { describe, expect, it } from "vitest";

import { announceReducer, initialAnnounceState } from "./announce-reducer";

const banner = {
  tone: "error" as const,
  message: "You do not have access to that. Sign in again.",
};

/**
 * On a paired device a 401/403 only makes the gate re-check access, so the
 * screen may stay mounted. Every "start" must therefore have a settle action
 * that clears its busy state, or later taps are ignored until a reload.
 */
describe("busy state is always settleable", () => {
  it("resolve/start is cleared by resolve/error, which keeps the sentence", () => {
    const busy = announceReducer(initialAnnounceState(), {
      type: "resolve/start",
    });
    expect(busy.resolving).toBe(true);

    const settled = announceReducer(busy, { type: "resolve/error", banner });
    expect(settled.resolving).toBe(false);
    expect(settled.banner).toEqual(banner);
  });

  it("confirm/start is cleared by confirm/error, which keeps the sentence", () => {
    for (const key of ["multi", "pad", "unannounce:s1", "someCandidate"]) {
      const busy = announceReducer(initialAnnounceState(), {
        type: "confirm/start",
        key,
      });
      expect(busy.confirmingKey).toBe(key);

      const settled = announceReducer(busy, { type: "confirm/error", banner });
      expect(settled.confirmingKey).toBeNull();
      expect(settled.banner).toEqual(banner);
    }
  });
});
