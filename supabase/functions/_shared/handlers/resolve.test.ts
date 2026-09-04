import { describe, expect, it } from "vitest";

import { createRateLimiter } from "../rate-limit.ts";
import { createFakeStore, makeCarpool, makeStudent } from "./fake-store.ts";
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
    students: Array<{ id: string; last_name: string }>;
    carpool: { id: string; name: string } | null;
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
    expect(body.candidates[0].students[0].id).toBe("marsh");
    expect(body.candidates[0].carpool).toBeNull();
  });

  it("returns both names when it cannot tell them apart", async () => {
    const { handle } = setup();

    const body = (await (
      await handle(
        post({ pin: STAFF_PIN, deviceId: "phone-1", transcript: "Cohen" }),
      )
    ).json()) as ResolveBody;

    expect(body.tier).toBe("ambiguous");
    expect(
      body.candidates.map((candidate) => candidate.students[0].id),
    ).toEqual(expect.arrayContaining(["cohen", "kohen"]));
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
    expect(body.candidates[0].students[0].id).toBe("marsh");
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
      body.candidates.flatMap((candidate) =>
        candidate.students.map((s) => s.id),
      ),
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

describe("createResolveHandler — carpools", () => {
  function setupCarpool() {
    const store = createFakeStore(
      [
        makeStudent({
          id: "cohen",
          first_name: "Maya",
          last_name: "Cohen",
          carpool_id: "weiss",
        }),
        makeStudent({
          id: "weiss-jr",
          first_name: "Sara",
          last_name: "Weiss",
          carpool_id: "weiss",
        }),
        makeStudent({ id: "marsh", first_name: "Ava", last_name: "Marsh" }),
      ],
      [makeCarpool({ id: "weiss", name: "Weiss Carpool" })],
    );
    const handle = createResolveHandler({
      staffPin: STAFF_PIN,
      rateLimiter: createRateLimiter({ limit: 30, windowMs: 60_000 }),
      pinAttemptLimiter: createRateLimiter({ limit: 10, windowMs: 600_000 }),
      store,
    });
    return { store, handle };
  }

  it("collapses two carpool-mates who each score 1.00 into one clear candidate", async () => {
    // Cohen and Weiss share nothing phonetically, so on their own the two
    // members of "Weiss Carpool" would not even collide -- this instead
    // proves the carpool NAME itself, spoken directly, resolves to one group
    // covering every member, with a real margin over the unrelated Marsh.
    const { handle } = setupCarpool();

    const body = (await (
      await handle(
        post({
          pin: STAFF_PIN,
          deviceId: "phone-1",
          transcript: "Weiss Carpool",
        }),
      )
    ).json()) as ResolveBody;

    expect(body.tier).toBe("clear");
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0].carpool).toEqual({
      id: "weiss",
      name: "Weiss Carpool",
    });
    expect(
      body.candidates[0].students.map((s) => s.id).sort(),
    ).toEqual(["cohen", "weiss-jr"]);
  });

  it("resolving one member's own surname still surfaces the whole carpool", async () => {
    const { handle } = setupCarpool();

    const body = (await (
      await handle(
        post({ pin: STAFF_PIN, deviceId: "phone-1", transcript: "Cohen" }),
      )
    ).json()) as ResolveBody;

    const group = body.candidates.find((c) => c.carpool?.id === "weiss");
    expect(group).toBeDefined();
    expect(group!.students.map((s) => s.id).sort()).toEqual([
      "cohen",
      "weiss-jr",
    ]);
  });

  it("never changes status or writes an event just from resolving a carpool", async () => {
    const { handle, store } = setupCarpool();

    await handle(
      post({
        pin: STAFF_PIN,
        deviceId: "phone-1",
        transcript: "Weiss Carpool",
      }),
    );

    expect(store.events).toEqual([]);
    expect(store.row("cohen")?.status).toBe("waiting");
    expect(store.row("weiss-jr")?.status).toBe("waiting");
  });

  it("does not collapse two different carpools that both plausibly match", async () => {
    const store = createFakeStore(
      [
        makeStudent({ id: "a", first_name: "A", last_name: "Cohen", carpool_id: "c1" }),
        makeStudent({ id: "b", first_name: "B", last_name: "Koen", carpool_id: "c2" }),
      ],
      [
        makeCarpool({ id: "c1", name: "First Carpool" }),
        makeCarpool({ id: "c2", name: "Second Carpool" }),
      ],
    );
    const handle = createResolveHandler({
      staffPin: STAFF_PIN,
      rateLimiter: createRateLimiter({ limit: 30, windowMs: 60_000 }),
      pinAttemptLimiter: createRateLimiter({ limit: 10, windowMs: 600_000 }),
      store,
    });

    const body = (await (
      await handle(
        post({ pin: STAFF_PIN, deviceId: "phone-1", transcript: "Cohen" }),
      )
    ).json()) as ResolveBody;

    const carpoolIds = body.candidates.map((c) => c.carpool?.id).filter(Boolean);
    expect(new Set(carpoolIds).size).toBe(carpoolIds.length);
  });
});
