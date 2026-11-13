import { describe, expect, it } from "vitest";

import { createRateLimiter } from "../rate-limit.ts";
import { LEGACY_SCHOOL_ID } from "../schools.ts";
import { createFakeAccess } from "./fake-access.ts";
import {
  authenticateRequest,
  type GuardDeps,
  guardRequest as guardRequestFor,
  guardSessionRequest,
} from "./guard.ts";

/**
 * The staff-PIN tests below predate capabilities. A PIN holder may do
 * everything in the legacy school, so which capability they ask for does not
 * matter; `office` is the strictest.
 */
const guardRequest = (request: Request, d: GuardDeps) =>
  guardRequestFor(request, d, "office");

const STAFF_PIN = "4821";

function deps(overrides: Partial<GuardDeps> = {}): GuardDeps {
  return {
    staffPin: STAFF_PIN,
    rateLimiter: createRateLimiter({ limit: 1000, windowMs: 60_000 }),
    pinAttemptLimiter: createRateLimiter({ limit: 10, windowMs: 600_000 }),
    access: createFakeAccess(),
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

/* ------------------------------------------------------------------ */
/* Supabase sessions: the only way in for every school but the first.  */
/* ------------------------------------------------------------------ */

const SCHOOL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SCHOOL_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** Two schools, an office login for each, and one device of each kind in A. */
function world() {
  const access = createFakeAccess();
  access.addUser("office-a", { userId: "user-office-a" });
  access.grant("user-office-a", SCHOOL_A, { kind: "member", role: "owner" });
  access.addUser("office-b", { userId: "user-office-b" });
  access.grant("user-office-b", SCHOOL_B, { kind: "member", role: "owner" });

  access.addUser("curb-phone-a", { userId: "user-curb-a", isAnonymous: true });
  access.grant("user-curb-a", SCHOOL_A, {
    kind: "device",
    canAnnounce: true,
    canDisplay: false,
  });
  access.addUser("wall-board-a", { userId: "user-wall-a", isAnonymous: true });
  access.grant("user-wall-a", SCHOOL_A, {
    kind: "device",
    canAnnounce: false,
    canDisplay: true,
  });
  // Signed in, but nothing to any school: a device that never paired.
  access.addUser("stranger", { userId: "user-stranger", isAnonymous: true });
  return access;
}

function withToken(token: string, body: Record<string, unknown>): Request {
  return post(
    { deviceId: "phone-1", ...body },
    { authorization: `Bearer ${token}` },
  );
}

describe("guardRequest with a Supabase session", () => {
  it("lets an office login use an office endpoint in its own school", async () => {
    const result = await guardRequestFor(
      withToken("office-a", { schoolId: SCHOOL_A, n: 2 }),
      deps({ access: world() }),
      "office",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.schoolId).toBe(SCHOOL_A);
    expect(result.caller).toEqual({
      kind: "member",
      userId: "user-office-a",
      role: "owner",
    });
    expect(result.body.n).toBe(2);
    expect(result.deviceId).toBe("phone-1");
  });

  it("lets an office login announce in its own school", async () => {
    const result = await guardRequestFor(
      withToken("office-a", { schoolId: SCHOOL_A }),
      deps({ access: world() }),
      "announce",
    );
    expect(result.ok).toBe(true);
  });

  it("refuses an office login naming another school, without saying the school exists", async () => {
    const real = await guardRequestFor(
      withToken("office-a", { schoolId: SCHOOL_B }),
      deps({ access: world() }),
      "office",
    );
    const invented = await guardRequestFor(
      withToken("office-a", {
        schoolId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      }),
      deps({ access: world() }),
      "office",
    );

    expect(real.ok).toBe(false);
    expect(invented.ok).toBe(false);
    if (real.ok || invented.ok) return;
    expect(real.response.status).toBe(403);
    expect(invented.response.status).toBe(403);
    // Identical answers: a school id cannot be confirmed by probing.
    expect(await real.response.json()).toEqual(await invented.response.json());
  });

  it("lets a curb phone announce but not reach the office", async () => {
    const access = world();
    const announce = await guardRequestFor(
      withToken("curb-phone-a", { schoolId: SCHOOL_A }),
      deps({ access }),
      "announce",
    );
    const office = await guardRequestFor(
      withToken("curb-phone-a", { schoolId: SCHOOL_A }),
      deps({ access }),
      "office",
    );

    expect(announce.ok).toBe(true);
    if (announce.ok) {
      expect(announce.caller).toEqual({
        kind: "device",
        userId: "user-curb-a",
      });
    }
    expect(office.ok).toBe(false);
    if (office.ok) return;
    expect(office.response.status).toBe(403);
    await expect(office.response.json()).resolves.toEqual({
      error: expect.stringMatching(/office account/i),
    });
  });

  it("refuses a wall board on every endpoint: a board only reads", async () => {
    const access = world();
    for (const capability of ["announce", "office"] as const) {
      const result = await guardRequestFor(
        withToken("wall-board-a", { schoolId: SCHOOL_A }),
        deps({ access }),
        capability,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.response.status).toBe(403);
    }
  });

  it("refuses a curb phone naming another school", async () => {
    const result = await guardRequestFor(
      withToken("curb-phone-a", { schoolId: SCHOOL_B }),
      deps({ access: world() }),
      "announce",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(403);
  });

  it("refuses a signed-in device that never paired with any school", async () => {
    const result = await guardRequestFor(
      withToken("stranger", { schoolId: SCHOOL_A }),
      deps({ access: world() }),
      "announce",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(403);
  });

  it("stops a device the moment the office disconnects it", async () => {
    const access = world();
    const d = deps({ access });
    const before = await guardRequestFor(
      withToken("curb-phone-a", { schoolId: SCHOOL_A }),
      d,
      "announce",
    );
    access.revoke("user-curb-a", SCHOOL_A);
    const after = await guardRequestFor(
      withToken("curb-phone-a", { schoolId: SCHOOL_A }),
      d,
      "announce",
    );

    expect(before.ok).toBe(true);
    expect(after.ok).toBe(false);
  });

  it("never treats an anonymous session as an office account, whatever a row says", async () => {
    const access = world();
    access.addUser("odd", { userId: "user-odd", isAnonymous: true });
    access.grant("user-odd", SCHOOL_A, { kind: "member", role: "owner" });

    const result = await guardRequestFor(
      withToken("odd", { schoolId: SCHOOL_A }),
      deps({ access }),
      "office",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(403);
  });

  it("refuses a token the sign-in service does not recognise", async () => {
    const result = await guardRequestFor(
      withToken("made-up", { schoolId: SCHOOL_A }),
      deps({ access: world() }),
      "announce",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
    await expect(result.response.json()).resolves.toEqual({
      error: expect.stringMatching(/sign in/i),
    });
  });

  it("refuses a request with no token and no PIN", async () => {
    const result = await guardRequestFor(
      post({ deviceId: "phone-1", schoolId: SCHOOL_A }),
      deps({ access: world() }),
      "announce",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
  });

  it("refuses a missing or malformed school id before looking anything up", async () => {
    for (const schoolId of [undefined, "", "school-a", 7, `${SCHOOL_A}'--`]) {
      const result = await guardRequestFor(
        withToken("office-a", { schoolId }),
        deps({ access: world() }),
        "office",
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.response.status).toBe(400);
    }
  });

  it("says the sign-in service is down rather than that the sign-in is wrong", async () => {
    const access = world();
    access.failNextVerify();
    const result = await guardRequestFor(
      withToken("office-a", { schoolId: SCHOOL_A }),
      deps({ access }),
      "office",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(503);
  });

  it("works with no staff PIN configured: sessions do not depend on it", async () => {
    const result = await guardRequestFor(
      withToken("office-a", { schoolId: SCHOOL_A }),
      deps({ access: world(), staffPin: undefined }),
      "office",
    );
    expect(result.ok).toBe(true);
  });

  it("still applies the per-device spam limit", async () => {
    const d = deps({
      access: world(),
      rateLimiter: createRateLimiter({ limit: 1, windowMs: 60_000 }),
    });
    await guardRequestFor(
      withToken("office-a", { schoolId: SCHOOL_A }),
      d,
      "office",
    );
    const second = await guardRequestFor(
      withToken("office-a", { schoolId: SCHOOL_A }),
      d,
      "office",
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.response.status).toBe(429);
  });
});

describe("guardRequest with the staff PIN, now that schools exist", () => {
  it("always means the legacy school, whatever school the body names", async () => {
    const result = await guardRequestFor(
      post({ pin: STAFF_PIN, deviceId: "phone-1", schoolId: SCHOOL_B }),
      deps({ access: world() }),
      "office",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.schoolId).toBe(LEGACY_SCHOOL_ID);
    expect(result.caller).toEqual({ kind: "legacy-pin" });
  });

  it("does not let a wrong PIN be rescued by a valid session", async () => {
    const access = world();
    const result = await guardRequestFor(
      post(
        { pin: "0000", deviceId: "phone-1", schoolId: SCHOOL_A },
        { authorization: "Bearer office-a" },
      ),
      deps({ access }),
      "office",
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
    // Judged by the PIN alone: the token was never even looked at.
    expect(access.verified).toEqual([]);
  });

  it("does not ask the sign-in service about a PIN request", async () => {
    const access = world();
    await guardRequestFor(
      post({ pin: STAFF_PIN, deviceId: "phone-1" }),
      deps({ access }),
      "announce",
    );
    expect(access.verified).toEqual([]);
  });
});

describe("authenticateRequest", () => {
  it("returns the signed-in user, anonymous or not, with no school involved", async () => {
    const result = await authenticateRequest(
      withToken("stranger", { code: "ABC123" }),
      deps({ access: world() }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user).toEqual({
      userId: "user-stranger",
      isAnonymous: true,
      emailConfirmed: true,
    });
    expect(result.body.code).toBe("ABC123");
  });

  it("has no staff-PIN way through", async () => {
    const result = await authenticateRequest(
      post({ pin: STAFF_PIN, deviceId: "phone-1" }),
      deps({ access: world() }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
  });

  it("refuses the project's public key, which is a token but not a person", async () => {
    const result = await authenticateRequest(
      withToken("anon-public-key", {}),
      deps({ access: world() }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
  });

  it("refuses anything but POST", async () => {
    const result = await authenticateRequest(
      new Request("https://example.test/fn", { method: "GET" }),
      deps({ access: world() }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(405);
  });
});

describe("guardSessionRequest", () => {
  it("accepts a session exactly as guardRequest does", async () => {
    const result = await guardSessionRequest(
      withToken("office-a", { schoolId: SCHOOL_A }),
      deps({ access: world() }),
      "office",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.schoolId).toBe(SCHOOL_A);
  });

  it("gives the staff PIN nothing, even the right one", async () => {
    const result = await guardSessionRequest(
      post({ pin: STAFF_PIN, deviceId: "phone-1" }),
      deps({ access: world() }),
      "office",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
  });

  it("keeps devices out of office endpoints", async () => {
    const result = await guardSessionRequest(
      withToken("curb-phone-a", { schoolId: SCHOOL_A }),
      deps({ access: world() }),
      "office",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(403);
  });

  it("refuses another school", async () => {
    const result = await guardSessionRequest(
      withToken("office-a", { schoolId: SCHOOL_B }),
      deps({ access: world() }),
      "office",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(403);
  });
});
