import { describe, expect, it } from "vitest";

import { createRateLimiter } from "../rate-limit.ts";
import { guardRequest } from "./guard.ts";

const STAFF_PIN = "4821";

function deps(overrides: Partial<Parameters<typeof guardRequest>[1]> = {}) {
  return {
    staffPin: STAFF_PIN,
    rateLimiter: createRateLimiter({ limit: 1000, windowMs: 60_000 }),
    pinAttemptLimiter: createRateLimiter({ limit: 10, windowMs: 600_000 }),
    ...overrides,
  };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/fn", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("guardRequest", () => {
  it("passes a request with the right PIN through, with its body", async () => {
    const result = await guardRequest(
      post({ pin: STAFF_PIN, deviceId: "phone-1", n: 2 }),
      deps(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.n).toBe(2);
    expect(result.deviceId).toBe("phone-1");
  });

  it("refuses anything but POST", async () => {
    const result = await guardRequest(
      new Request("https://example.test/fn", { method: "GET" }),
      deps(),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(405);
  });

  it("refuses a wrong PIN with a sentence the announce page can show", async () => {
    const result = await guardRequest(
      post({ pin: "0000", deviceId: "phone-1" }),
      deps(),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
    await expect(result.response.json()).resolves.toEqual({
      error: expect.stringMatching(/PIN/i),
    });
  });

  it("refuses a missing PIN", async () => {
    const result = await guardRequest(post({ deviceId: "phone-1" }), deps());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
  });

  it("refuses everything when the server has no PIN configured, and says why", async () => {
    // Still fails closed. But telling staff "that PIN was not recognised"
    // forever, when in fact no PIN exists to recognise, leaves a school with no
    // way to work out what is wrong. There is no PIN to protect here anyway.
    const result = await guardRequest(
      post({ pin: STAFF_PIN, deviceId: "phone-1" }),
      deps({ staffPin: undefined }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(503);
    await expect(result.response.json()).resolves.toEqual({
      error: expect.stringMatching(/not set up/i),
    });
  });

  it("throttles a device that is sending too fast", async () => {
    const shared = deps({
      rateLimiter: createRateLimiter({ limit: 2, windowMs: 60_000 }),
    });
    const send = () =>
      guardRequest(post({ pin: STAFF_PIN, deviceId: "phone-1" }), shared);

    await send();
    await send();
    const result = await send();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(429);
    expect(result.response.headers.get("retry-after")).toBe("60");
  });

  it("throttles PIN guesses too, by counting before it checks", async () => {
    // Rate limiting runs first on purpose: checking the PIN first would leave
    // guessing completely unthrottled, which is the one attack this app has.
    const shared = deps({
      rateLimiter: createRateLimiter({ limit: 1, windowMs: 60_000 }),
    });

    await guardRequest(post({ pin: "0000", deviceId: "phone-1" }), shared);
    const result = await guardRequest(
      post({ pin: "0001", deviceId: "phone-1" }),
      shared,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(429);
  });

  it("throttles PIN guessing even when the device id keeps changing", async () => {
    // deviceId comes from the request body: an attacker can send a fresh one
    // every time. If the guessing budget is keyed on it, there is no budget.
    // A 4-digit PIN falls in under 10,000 requests.
    const shared = deps();
    let throttled = 0;

    for (let attempt = 0; attempt < 60; attempt++) {
      const result = await guardRequest(
        post(
          {
            pin: String(attempt).padStart(4, "0"),
            deviceId: `device-${attempt}`,
          },
          { "x-forwarded-for": "203.0.113.5" },
        ),
        shared,
      );
      if (!result.ok && result.response.status === 429) throttled++;
    }

    expect(throttled).toBeGreaterThan(0);
  });

  it("counts a wrong PIN against the guesser, not against honest traffic", async () => {
    const shared = deps();
    const from = (ip: string, pin: string) =>
      guardRequest(
        post({ pin, deviceId: "phone-1" }, { "x-forwarded-for": ip }),
        shared,
      );

    // One office phone typing the PIN correctly all morning is not an attack.
    for (let i = 0; i < 40; i++) await from("198.51.100.7", STAFF_PIN);
    expect((await from("198.51.100.7", STAFF_PIN)).ok).toBe(true);
  });

  it("does not let one guesser lock out the rest of the school", async () => {
    const shared = deps();
    for (let i = 0; i < 60; i++) {
      await guardRequest(
        post(
          { pin: "0000", deviceId: `d-${i}` },
          { "x-forwarded-for": "203.0.113.5" },
        ),
        shared,
      );
    }

    const honest = await guardRequest(
      post(
        { pin: STAFF_PIN, deviceId: "phone-2" },
        { "x-forwarded-for": "198.51.100.7" },
      ),
      shared,
    );

    expect(honest.ok).toBe(true);
  });

  it("counts each device separately", async () => {
    const shared = deps({
      rateLimiter: createRateLimiter({ limit: 1, windowMs: 60_000 }),
    });

    await guardRequest(post({ pin: STAFF_PIN, deviceId: "phone-1" }), shared);
    const other = await guardRequest(
      post({ pin: STAFF_PIN, deviceId: "phone-2" }),
      shared,
    );

    expect(other.ok).toBe(true);
  });

  it("falls back to a header, then to one shared bucket, for the device id", async () => {
    const byHeader = await guardRequest(
      post({ pin: STAFF_PIN }, { "x-device-id": "tablet-9" }),
      deps(),
    );
    const byNothing = await guardRequest(post({ pin: STAFF_PIN }), deps());

    expect(byHeader.ok && byHeader.deviceId).toBe("tablet-9");
    expect(byNothing.ok && byNothing.deviceId).toBe("anonymous");
  });

  it("treats an unreadable body as a missing PIN rather than crashing", async () => {
    const request = new Request("https://example.test/fn", {
      method: "POST",
      body: "{oops",
    });

    const result = await guardRequest(request, deps());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
  });
});
