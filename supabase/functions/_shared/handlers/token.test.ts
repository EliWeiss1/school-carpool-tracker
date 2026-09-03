import { describe, expect, it } from "vitest";

import { createRateLimiter } from "../rate-limit.ts";
import { createFakeStore, makeStudent } from "./fake-store.ts";
import { createTokenHandler } from "./token.ts";

const STAFF_PIN = "4821";

const ROSTER = [
  makeStudent({
    id: "a",
    last_name: "Cohen",
    aliases: ["Kohen"],
    class_group: "K-Alvarez",
  }),
  makeStudent({ id: "b", last_name: "Nguyen", class_group: "4-Espinoza" }),
  makeStudent({
    id: "c",
    last_name: "Brooks",
    class_group: "K-Alvarez",
    status: "arrived",
  }),
];

function handler(
  overrides: {
    mintToken?: () => Promise<{ token: string; expiresIn: number }>;
  } = {},
) {
  return createTokenHandler({
    staffPin: STAFF_PIN,
    rateLimiter: createRateLimiter({ limit: 30, windowMs: 60_000 }),
    pinAttemptLimiter: createRateLimiter({ limit: 10, windowMs: 600_000 }),
    store: createFakeStore(ROSTER),
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
});
