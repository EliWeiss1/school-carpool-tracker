import { describe, expect, it, vi } from "vitest";

import { createRateLimiter } from "../rate-limit.ts";
import { createFakeStore, makeStudent, legacyStores } from "./fake-store.ts";
import { createFakeAccess } from "./fake-access.ts";
import { createFakeUsage } from "./fake-usage.ts";
import { LEGACY_SCHOOL_ID } from "../schools.ts";
import { createTokenHandler } from "./token.ts";

const STAFF_PIN = "4821";

const ROSTER = [
  makeStudent({
    id: "a",
    last_name: "Cohen",
    aliases: ["Kohen"],
    class_groups: ["K-Alvarez"],
  }),
  makeStudent({ id: "b", last_name: "Nguyen", class_groups: ["4-Espinoza"] }),
  makeStudent({
    id: "c",
    last_name: "Brooks",
    class_groups: ["K-Alvarez"],
    status: "arrived",
  }),
];

function handler(
  overrides: {
    mintToken?: () => Promise<{ token: string; expiresIn: number }>;
    usage?: ReturnType<typeof createFakeUsage>;
  } = {},
) {
  return createTokenHandler({
    usage: overrides.usage ?? createFakeUsage(),
    staffPin: STAFF_PIN,
    rateLimiter: createRateLimiter({ limit: 30, windowMs: 60_000 }),
    pinAttemptLimiter: createRateLimiter({ limit: 10, windowMs: 600_000 }),
    stores: legacyStores(createFakeStore(ROSTER)),
    access: createFakeAccess(),
    mintToken:
      overrides.mintToken ??
      (() => Promise.resolve({ token: "dg_temp", expiresIn: 300 })),
  });
}

const post = (body: unknown) =>
  new Request("https://example.test/deepgram-token", {
    method: "POST",
    body: JSON.stringify(body),
  });

describe("createTokenHandler", () => {
  it("hands back a token and the roster's keyterms", async () => {
    const response = await handler()(
      post({ pin: STAFF_PIN, deviceId: "phone-1" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      token: "dg_temp",
      expiresIn: 300,
      keyterms: ["Cohen", "Nguyen", "Brooks", "Kohen"],
    });
  });

  it("narrows the keyterms to the class the announcer picked", async () => {
    const response = await handler()(
      post({ pin: STAFF_PIN, deviceId: "phone-1", classGroup: "4-Espinoza" }),
    );

    const body = (await response.json()) as { keyterms: string[] };
    expect(body.keyterms).toEqual(["Nguyen"]);
  });

  it("narrows the keyterms to several classes at once", async () => {
    const response = await handler()(
      post({
        pin: STAFF_PIN,
        deviceId: "phone-1",
        classGroups: ["4-Espinoza", "K-Alvarez"],
      }),
    );

    const body = (await response.json()) as { keyterms: string[] };
    expect(body.keyterms).toEqual(["Cohen", "Nguyen", "Brooks", "Kohen"]);
  });

  it("requires the staff PIN", async () => {
    const response = await handler()(post({ deviceId: "phone-1" }));

    expect(response.status).toBe(401);
  });

  it("answers a CORS preflight", async () => {
    const response = await handler()(
      new Request("https://example.test/deepgram-token", { method: "OPTIONS" }),
    );

    expect(response.status).toBe(204);
  });

  it("explains a speech-service failure instead of returning a broken token", async () => {
    const failing = handler({
      mintToken: () =>
        Promise.reject(new Error("Could not reach the speech service.")),
    });

    const response = await failing(
      post({ pin: STAFF_PIN, deviceId: "phone-1" }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Could not reach the speech service.",
    });
  });

  describe("voice metering", () => {
    const body = { pin: STAFF_PIN, deviceId: "phone-1" };

    it("claims one session per token, against the legacy school for a PIN", async () => {
      const usage = createFakeUsage();
      const response = await handler({ usage })(post(body));

      expect(response.status).toBe(200);
      expect(usage.claims).toEqual([LEGACY_SCHOOL_ID]);
    });

    it("mints nothing when the monthly limit is used up", async () => {
      const usage = createFakeUsage();
      usage.configure(LEGACY_SCHOOL_ID, { limit: 1, used: 1 });
      const mintToken = vi.fn(() =>
        Promise.resolve({ token: "dg_temp", expiresIn: 300 }),
      );

      const response = await handler({ usage, mintToken })(post(body));

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error:
          "Voice is used up for this month. Type the name instead; the office can raise the limit.",
      });
      expect(mintToken).not.toHaveBeenCalled();
    });

    it("mints nothing when voice is turned off for the school", async () => {
      const usage = createFakeUsage();
      usage.configure(LEGACY_SCHOOL_ID, { enabled: false });
      const mintToken = vi.fn(() =>
        Promise.resolve({ token: "dg_temp", expiresIn: 300 }),
      );

      const response = await handler({ usage, mintToken })(post(body));

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: "Voice is turned off for this school. Type the name instead.",
      });
      expect(mintToken).not.toHaveBeenCalled();
    });

    it("refuses the claim that would exceed the limit, not the one before", async () => {
      const usage = createFakeUsage();
      usage.configure(LEGACY_SCHOOL_ID, { limit: 2 });
      const h = handler({ usage });

      expect((await h(post(body))).status).toBe(200);
      expect((await h(post(body))).status).toBe(200);
      expect((await h(post(body))).status).toBe(409);
    });

    it("fails closed when the counter cannot be reached", async () => {
      const usage = createFakeUsage();
      usage.failWith(new Error("connection refused"));
      const mintToken = vi.fn(() =>
        Promise.resolve({ token: "dg_temp", expiresIn: 300 }),
      );

      const response = await handler({ usage, mintToken })(post(body));

      expect(response.status).toBe(503);
      expect(mintToken).not.toHaveBeenCalled();
    });

    it("claims nothing for a wrong PIN or a missing one", async () => {
      const usage = createFakeUsage();
      const h = handler({ usage });

      expect((await h(post({ pin: "0000", deviceId: "p" }))).status).toBe(401);
      expect((await h(post({ deviceId: "p" }))).status).toBe(401);
      expect(usage.claims).toEqual([]);
    });

    it("still claims when speech is mocked, so the cap is testable", async () => {
      const usage = createFakeUsage();
      usage.configure(LEGACY_SCHOOL_ID, { limit: 0 });
      // mintToken stands in for mock mode: it would succeed with no Deepgram.
      const response = await handler({ usage })(post(body));

      expect(usage.claims).toHaveLength(1);
      expect(response.status).toBe(409);
    });
  });
});
