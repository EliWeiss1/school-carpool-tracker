import { describe, expect, it } from "vitest";

import { createRateLimiter } from "./rate-limit.ts";

/** A controllable clock, so the tests never sleep. */
function fakeClock(start = 0) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("createRateLimiter", () => {
  it("allows requests up to the limit", () => {
    const limiter = createRateLimiter({
      limit: 3,
      windowMs: 60_000,
      now: fakeClock().now,
    });

    expect(limiter.check("device-a").allowed).toBe(true);
    expect(limiter.check("device-a").allowed).toBe(true);
    expect(limiter.check("device-a").allowed).toBe(true);
  });

  it("blocks the request after the limit and says how long to wait", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({
      limit: 2,
      windowMs: 60_000,
      now: clock.now,
    });

    limiter.check("device-a");
    limiter.check("device-a");
    clock.advance(10_000);
    const blocked = limiter.check("device-a");

    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBe(50);
  });

  it("reports how many requests are left", () => {
    const limiter = createRateLimiter({
      limit: 3,
      windowMs: 60_000,
      now: fakeClock().now,
    });

    expect(limiter.check("device-a").remaining).toBe(2);
    expect(limiter.check("device-a").remaining).toBe(1);
    expect(limiter.check("device-a").remaining).toBe(0);
  });

  it("counts each device separately", () => {
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: 60_000,
      now: fakeClock().now,
    });

    expect(limiter.check("device-a").allowed).toBe(true);
    expect(limiter.check("device-b").allowed).toBe(true);
    expect(limiter.check("device-a").allowed).toBe(false);
  });

  it("lets a device through again once its window has passed", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: 60_000,
      now: clock.now,
    });

    limiter.check("device-a");
    clock.advance(59_999);
    expect(limiter.check("device-a").allowed).toBe(false);

    clock.advance(2);
    expect(limiter.check("device-a").allowed).toBe(true);
  });

  it("reports whether a key is out of budget without spending any of it", () => {
    // The PIN guard needs to know a caller is blocked *before* it checks the
    // PIN, but a legitimate request must not cost the caller an attempt.
    const limiter = createRateLimiter({
      limit: 2,
      windowMs: 60_000,
      now: fakeClock().now,
    });

    expect(limiter.peek("device-a").allowed).toBe(true);
    expect(limiter.peek("device-a").allowed).toBe(true);
    expect(limiter.check("device-a").allowed).toBe(true);
    expect(limiter.check("device-a").allowed).toBe(true);

    const peeked = limiter.peek("device-a");
    expect(peeked.allowed).toBe(false);
    expect(peeked.retryAfterSeconds).toBe(60);
  });

  it("forgets devices whose window has expired instead of growing forever", () => {
    // The limiter lives for the lifetime of an Edge Function isolate. A map that
    // only ever grows is a slow leak in a process nobody restarts on purpose.
    const clock = fakeClock();
    const limiter = createRateLimiter({
      limit: 5,
      windowMs: 60_000,
      now: clock.now,
    });

    for (let i = 0; i < 50; i++) limiter.check(`device-${i}`);
    expect(limiter.size()).toBe(50);

    clock.advance(60_001);
    limiter.check("device-new");
    expect(limiter.size()).toBe(1);
  });
});

describe("forgive", () => {
  it("hands back what a check spent, so only failures add up", () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 });
    for (let i = 0; i < 10; i++) {
      expect(limiter.check("ip").allowed).toBe(true);
      limiter.forgive("ip");
    }
    expect(limiter.peek("ip").remaining).toBe(2);
  });

  it("does not forgive what was never forgiven: failures still run out", () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 });
    expect(limiter.check("ip").allowed).toBe(true);
    expect(limiter.check("ip").allowed).toBe(true);
    expect(limiter.check("ip").allowed).toBe(false);
  });

  it("never takes a key below zero", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    limiter.forgive("ip");
    limiter.forgive("ip");
    expect(limiter.check("ip").allowed).toBe(true);
    expect(limiter.check("ip").allowed).toBe(false);
  });

  it("leaves other keys alone", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    limiter.check("a");
    limiter.forgive("b");
    expect(limiter.peek("a").allowed).toBe(false);
  });
});
