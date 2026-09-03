import { describe, expect, it } from "vitest";

import { createRateLimiter } from "../rate-limit.ts";
import { createFakeStore, makeStudent } from "./fake-store.ts";
import { createResolveHandler } from "./resolve.ts";

const STAFF_PIN = "4821";

const ROSTER = [
  makeStudent({
    id: "cohen",
    first_name: "Maya",
    last_name: "Cohen",
    aliases: ["Kohen"],
    grade: "K",
  }),
  makeStudent({
    id: "kohen",
    first_name: "Elias",
    last_name: "Kohen",
    aliases: ["Cohen"],
    grade: "K",
  }),
  makeStudent({
    id: "marsh",
    first_name: "Ava",
    last_name: "Marsh",
    grade: "4",
  }),
];

function setup() {
  const store = createFakeStore(ROSTER);
  const handle = createResolveHandler({
    staffPin: STAFF_PIN,
    rateLimiter: createRateLimiter({ limit: 30, windowMs: 60_000 }),
    pinAttemptLimiter: createRateLimiter({ limit: 10, windowMs: 600_000 }),
    store,
  });
  return { store, handle };
}

const post = (body: unknown) =>
  new Request("https://example.test/resolve-name", {
    method: "POST",
    body: JSON.stringify(body),
  });

interface ResolveBody {
  tier: string;
  transcript: string;
  candidates: Array<{
    student: { id: string; last_name: string };
    score: number;
  }>;
}

describe("createResolveHandler", () => {
  it("returns a clear match as a single pre-highlighted candidate", async () => {
    const { handle } = setup();

    const response = await handle(
      post({ pin: STAFF_PIN, deviceId: "phone-1", transcript: "Marsh" }),
    );
    const body = (await response.json()) as ResolveBody;

    expect(response.status).toBe(200);
    expect(body.tier).toBe("clear");
    expect(body.candidates[0].student.id).toBe("marsh");
  });

  it("returns both names when it cannot tell them apart", async () => {
    const { handle } = setup();

    const body = (await (
      await handle(
        post({ pin: STAFF_PIN, deviceId: "phone-1", transcript: "Cohen" }),
      )
    ).json()) as ResolveBody;

    expect(body.tier).toBe("ambiguous");
    expect(body.candidates.map((candidate) => candidate.student.id)).toEqual(
      expect.arrayContaining(["cohen", "kohen"]),
    );
  });

  it("reports no match as a normal answer, not an error", async () => {
    // The announce page drops to its typed search on this. A 4xx would make it
    // look like something broke, which is exactly the wrong message outdoors.
    const { handle } = setup();

    const response = await handle(
      post({ pin: STAFF_PIN, deviceId: "phone-1", transcript: "Washington" }),
    );
    const body = (await response.json()) as ResolveBody;

    expect(response.status).toBe(200);
    expect(body.tier).toBe("none");
    expect(body.candidates).toEqual([]);
  });

  it("takes Deepgram's alternatives with their confidences", async () => {
    const { handle } = setup();

    const body = (await (
      await handle(
        post({
          pin: STAFF_PIN,
          deviceId: "phone-1",
          alternatives: [
            { transcript: "mmm", confidence: 0.2 },
            { transcript: "Marsh", confidence: 0.9 },
          ],
        }),
      )
    ).json()) as ResolveBody;

    expect(body.tier).toBe("clear");
    expect(body.candidates[0].student.id).toBe("marsh");
    expect(body.transcript).toBe("Marsh");
  });

  it("searches only the class the announcer picked", async () => {
    const { handle } = setup();

    const body = (await (
      await handle(
        post({
          pin: STAFF_PIN,
          deviceId: "phone-1",
          transcript: "Marsh",
          grade: "K",
        }),
      )
    ).json()) as ResolveBody;

    expect(
      body.candidates.map((candidate) => candidate.student.id),
    ).not.toContain("marsh");
  });

  it("asks for something to match when the transcript is empty", async () => {
    const { handle } = setup();

    const response = await handle(
      post({ pin: STAFF_PIN, deviceId: "phone-1", transcript: "   " }),
    );

    expect(response.status).toBe(400);
  });

  it("never changes a status", async () => {
    // Resolving is a read. The only thing that writes is /set-status, after a tap.
    const { handle, store } = setup();

    await handle(
      post({ pin: STAFF_PIN, deviceId: "phone-1", transcript: "Marsh" }),
    );

    expect(store.events).toEqual([]);
    expect(store.row("marsh")?.status).toBe("waiting");
  });

  it("requires the staff PIN", async () => {
    const { handle } = setup();

    const response = await handle(
      post({ deviceId: "phone-1", transcript: "Marsh" }),
    );

    expect(response.status).toBe(401);
  });
});
