import { describe, expect, it } from "vitest";

import { createChimeCoalescer, createChimePlayer } from "./display-chime";

describe("chime coalescer", () => {
  it("plays for the first arrival", () => {
    const coalescer = createChimeCoalescer({ windowMs: 1000, now: () => 0 });
    expect(coalescer.notify()).toBe(true);
  });

  it("suppresses a second arrival inside the window", () => {
    let t = 0;
    const coalescer = createChimeCoalescer({ windowMs: 1000, now: () => t });
    expect(coalescer.notify()).toBe(true);
    t = 400;
    expect(coalescer.notify()).toBe(false);
  });

  it("allows a fresh chime once the window has fully passed", () => {
    let t = 0;
    const coalescer = createChimeCoalescer({ windowMs: 1000, now: () => t });
    expect(coalescer.notify()).toBe(true);
    t = 1000;
    expect(coalescer.notify()).toBe(true);
  });

  it("coalesces a burst of five near-simultaneous arrivals into exactly one play", () => {
    let t = 0;
    const coalescer = createChimeCoalescer({ windowMs: 1500, now: () => t });
    const results = [0, 50, 120, 300, 900].map((offsetMs) => {
      t = offsetMs;
      return coalescer.notify();
    });

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results[0]).toBe(true);
  });

  it("treats two arrivals spaced further apart than the window as two separate chimes", () => {
    let t = 0;
    const coalescer = createChimeCoalescer({ windowMs: 500, now: () => t });
    expect(coalescer.notify()).toBe(true);
    t = 501;
    expect(coalescer.notify()).toBe(true);
  });
});

describe("chime player", () => {
  it("resolves false rather than throwing when there is no window (e.g. under Vitest's node environment)", async () => {
    const player = createChimePlayer("/chime.wav");
    await expect(player.play()).resolves.toBe(false);
  });
});
