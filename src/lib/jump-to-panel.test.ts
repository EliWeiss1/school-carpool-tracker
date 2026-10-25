import { describe, expect, it } from "vitest";

import { scrollBehaviorFor } from "./jump-to-panel";

describe("scrollBehaviorFor", () => {
  it("scrolls smoothly by default", () => {
    expect(scrollBehaviorFor(false)).toBe("smooth");
  });
  it("jumps instantly when the viewer prefers reduced motion", () => {
    expect(scrollBehaviorFor(true)).toBe("auto");
  });
});
