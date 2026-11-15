import { describe, expect, it } from "vitest";

import { createRateLimiter } from "../rate-limit.ts";
import { createFakeAccess } from "./fake-access.ts";
import {
  createFakeSchoolStore,
  type FakeSchoolStore,
} from "./fake-school-store.ts";
import { createPairDeviceHandler } from "./pair-device.ts";

const SCHOOL = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const DEVICE_USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OFFICE_USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const START = Date.parse("2026-11-13T12:00:00Z");

const NOT_RECOGNISED = "That code was not recognised. Check with the office.";

function seededStore(): FakeSchoolStore {
  const schools = createFakeSchoolStore(START);
  schools.seedSchool(
    { id: SCHOOL, slug: "maple", name: "Maple School" },
    { announceCode: "CURB123", displayCode: "BOARD456" },
  );
  schools.seedSchool(
    { id: OTHER, slug: "oak", name: "Oak School" },
    { announceCode: "SAME999", displayCode: "SAME999" },
  );
  return schools;
}

function makeAccess() {
  const access = createFakeAccess();
  access.addUser("device-token", { userId: DEVICE_USER, isAnonymous: true });
  access.addUser("office-token", { userId: OFFICE_USER, isAnonymous: false });
  return access;
}

/**
 * A handler over `schools`. Passing the same store to several handlers gives
 * each a fresh in-function limiter, which isolates the database's own rules.
 */
function makeHandler(
  schools: FakeSchoolStore,
  opts: { ipBudget?: number; access?: ReturnType<typeof makeAccess> } = {},
) {
  return createPairDeviceHandler({
    access: opts.access ?? makeAccess(),
    schools,
    rateLimiter: createRateLimiter({ limit: 1000, windowMs: 60_000 }),
    codeAttemptLimiter: createRateLimiter({
      limit: opts.ipBudget ?? 5,
      windowMs: 600_000,
      now: () => START,
    }),
    now: schools.now,
  });
}

function setup(opts: { ipBudget?: number } = {}) {
  const access = makeAccess();
  const schools = seededStore();
  const handle = makeHandler(schools, { ...opts, access });
  return { access, schools, handle };
}

function post(
  body: unknown,
  token: string | null = "device-token",
  ip = "203.0.113.5",
) {
  return new Request("https://example.test/pair-device", {
    method: "POST",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

const pair = (overrides: Record<string, unknown> = {}) => ({
  schoolSlug: "maple",
  code: "CURB123",
  deviceId: "phone-1",
  ...overrides,
});

describe("pair-device — success", () => {
  it("pairs for announcing with the announce code and returns no codes", async () => {
    const { handle, schools } = setup();
    const res = await handle(post(pair({ label: " Front door " })));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      school: { id: SCHOOL, name: "Maple School", slug: "maple" },
      canAnnounce: true,
      canDisplay: false,
    });
    expect(text).not.toContain("CURB123");
    expect(text).not.toContain("BOARD456");
    expect(schools.devices(SCHOOL)).toMatchObject([
      {
        userId: DEVICE_USER,
        canAnnounce: true,
        canDisplay: false,
        label: "Front door",
      },
    ]);
  });

  it("pairs for the board with the display code, however it was typed", async () => {
    const { handle } = setup();
    const res = await handle(post(pair({ code: "board-456" })));
    expect(await res.json()).toMatchObject({
      canAnnounce: false,
      canDisplay: true,
    });
  });

  it("grants both when the two codes are equal", async () => {
    const { handle } = setup();
    const res = await handle(
      post(pair({ schoolSlug: "oak", code: "same 999" })),
    );
    expect(await res.json()).toMatchObject({
      canAnnounce: true,
      canDisplay: true,
    });
  });

  it("merges when the same device pairs with the second code", async () => {
    const { handle, schools } = setup();
    await handle(post(pair()));
    await handle(post(pair({ code: "BOARD456" })));
    expect(schools.devices(SCHOOL)).toMatchObject([
      { canAnnounce: true, canDisplay: true },
    ]);
  });
});

describe("pair-device — who may pair", () => {
  it("refuses an office account", async () => {
    const { handle, schools } = setup();
    const res = await handle(post(pair(), "office-token"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(
      "Open the school's link on the phone or screen itself to connect it.",
    );
    expect(schools.devices()).toHaveLength(0);
  });

  it("refuses a missing or unknown session", async () => {
    const { handle } = setup();
    expect((await handle(post(pair(), null))).status).toBe(401);
    expect((await handle(post(pair(), "garbage"))).status).toBe(401);
  });

  it("gives the staff PIN nothing", async () => {
    const { handle, schools } = setup();
    const res = await handle(post({ ...pair(), pin: "4821" }, null));
    expect(res.status).toBe(401);
    expect(schools.calls.attemptPairing).toBe(0);
  });

  it("rejects a non-POST method and answers preflight", async () => {
    const { handle } = setup();
    const get = await handle(
      new Request("https://example.test/pair-device", { method: "GET" }),
    );
    expect(get.status).toBe(405);
    const options = await handle(
      new Request("https://example.test/pair-device", { method: "OPTIONS" }),
    );
    expect(options.status).toBe(204);
  });

  it("refuses an over-long label before comparing any code", async () => {
    const { handle, schools } = setup();
    const res = await handle(post(pair({ label: "x".repeat(61) })));
    expect(res.status).toBe(400);
    expect(schools.calls.attemptPairing).toBe(0);
  });
});

describe("pair-device — uniform refusal", () => {
  it("answers unknown school, malformed slug, malformed code and wrong code identically", async () => {
    const { handle } = setup();
    const attempts = [
      pair({ schoolSlug: "nowhere" }),
      pair({ schoolSlug: "NOT A SLUG" }),
      pair({ code: "x" }),
      pair({ code: "WRONG123" }),
      pair({ code: undefined }),
      pair({ schoolSlug: undefined }),
    ];
    const seen = new Set<string>();
    for (const [i, body] of attempts.entries()) {
      // A fresh address each time so the IP budget never interferes.
      const res = await handle(post(body, "device-token", `198.51.100.${i}`));
      expect(res.status).toBe(403);
      seen.add(await res.text());
    }
    expect([...seen]).toEqual([JSON.stringify({ error: NOT_RECOGNISED })]);
  });

  it("does not call the store for a malformed slug or code, but spends the budget", async () => {
    const { handle, schools } = setup({ ipBudget: 2 });
    await handle(post(pair({ schoolSlug: "NOT A SLUG" })));
    await handle(post(pair({ code: "x" })));
    expect(schools.calls.attemptPairing).toBe(0);
    expect((await handle(post(pair()))).status).toBe(429);
  });

  it("does not use the code of a school that is not the one named", async () => {
    const { handle } = setup();
    // SAME999 belongs to oak, not maple.
    expect((await handle(post(pair({ code: "SAME999" })))).status).toBe(403);
  });

  it("does not pair against a school with no code set", async () => {
    const { handle, schools } = setup();
    schools.seedSchool({
      id: "33333333-3333-4333-8333-333333333333",
      slug: "blank",
    });
    const res = await handle(
      post(pair({ schoolSlug: "blank", code: "ABCDEF" })),
    );
    expect(res.status).toBe(403);
  });
});

describe("pair-device — per-IP budget", () => {
  it("never charges a right code, however many in a row", async () => {
    const { handle, schools } = setup();
    for (let i = 0; i < 30; i++) {
      expect((await handle(post(pair()))).status).toBe(200);
    }
    expect(schools.devices(SCHOOL)).toHaveLength(1);
  });

  it("refuses once the wrong codes have used the budget up", async () => {
    const { handle } = setup({ ipBudget: 2 });
    expect((await handle(post(pair({ code: "WRONG1" })))).status).toBe(403);
    expect((await handle(post(pair({ code: "WRONG2" })))).status).toBe(403);

    const blocked = await handle(post(pair()));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("is per address", async () => {
    const { handle } = setup({ ipBudget: 1 });
    await handle(post(pair({ code: "WRONG1" })));
    expect((await handle(post(pair()))).status).toBe(429);
    expect(
      (await handle(post(pair(), "device-token", "192.0.2.9"))).status,
    ).toBe(200);
  });

  it("spends on an unknown school too", async () => {
    const { handle } = setup({ ipBudget: 1 });
    await handle(post(pair({ schoolSlug: "nowhere" })));
    expect((await handle(post(pair()))).status).toBe(429);
  });

  it("lets at most the budget of 50 parallel wrong codes from one address reach the store", async () => {
    const { handle, schools } = setup({ ipBudget: 5 });
    const responses = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        handle(post(pair({ code: `WRONG${i}` }))),
      ),
    );
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 403)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(45);
    expect(schools.calls.attemptPairing).toBe(5);
  });
});

describe("pair-device — locks in the database", () => {
  /** Wrong codes, each through a handler with a fresh in-function limiter. */
  async function wrong(schools: FakeSchoolStore, n: number, ip: string) {
    for (let i = 0; i < n; i++) {
      await makeHandler(schools)(
        post(pair({ code: "WRONG123" }), "device-token", ip),
      );
    }
  }

  it("locks one address on its eleventh wrong code, and says how long to wait", async () => {
    const schools = seededStore();
    await wrong(schools, 10, "10.0.0.1");
    const res = await makeHandler(schools)(
      post(pair({ code: "WRONG123" }), "device-token", "10.0.0.1"),
    );
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe(
      "Too many wrong codes for this school. Wait a few minutes, or ask the office to check the code.",
    );
    // Even the right code waits while the address is locked.
    const right = await makeHandler(schools)(
      post(pair(), "device-token", "10.0.0.1"),
    );
    expect(right.status).toBe(429);
    expect(Number(right.headers.get("retry-after"))).toBe(15 * 60);
  });

  it("a lock on one address does not stop another pairing with the right code", async () => {
    const schools = seededStore();
    await wrong(schools, 10, "10.0.0.1");
    const res = await makeHandler(schools)(
      post(pair(), "device-token", "10.0.0.2"),
    );
    expect(res.status).toBe(200);
  });

  it("pairs again once the lock has passed", async () => {
    const schools = seededStore();
    await wrong(schools, 10, "10.0.0.1");
    schools.setNow(START + 15 * 60_000 + 1);
    const res = await makeHandler(schools)(
      post(pair(), "device-token", "10.0.0.1"),
    );
    expect(res.status).toBe(200);
  });

  it("leaves connected devices alone while locked", async () => {
    const schools = seededStore();
    await makeHandler(schools)(post(pair()));
    await wrong(schools, 11, "10.0.0.1");
    expect(schools.devices(SCHOOL)).toHaveLength(1);
  });

  it("50 wrong codes from 50 addresses are all refused, and the school locks only past 100", async () => {
    const schools = seededStore();
    const statuses: number[] = [];
    for (let i = 0; i < 50; i++) {
      const res = await makeHandler(schools)(
        post(pair({ code: "WRONG123" }), "device-token", `10.1.0.${i}`),
      );
      statuses.push(res.status);
    }
    expect(statuses.every((s) => s === 403)).toBe(true);

    // Reach 100 wrong codes in the hour: the 101st attempt from a new address
    // is locked, even with the right code.
    for (let i = 50; i < 100; i++) {
      await makeHandler(schools)(
        post(pair({ code: "WRONG123" }), "device-token", `10.1.0.${i}`),
      );
    }
    const locked = await makeHandler(schools)(
      post(pair(), "device-token", "10.2.0.1"),
    );
    expect(locked.status).toBe(429);
    // Another school is unaffected.
    const other = await makeHandler(schools)(
      post(pair({ schoolSlug: "oak", code: "SAME999" })),
    );
    expect(other.status).toBe(200);
  });

  it("changing the code clears the locks", async () => {
    const schools = seededStore();
    await wrong(schools, 10, "10.0.0.1");
    await schools.setCode(SCHOOL, "announce", "FRESH123", false);
    const res = await makeHandler(schools)(
      post(pair({ code: "FRESH123" }), "device-token", "10.0.0.1"),
    );
    expect(res.status).toBe(200);
  });
});
