import { describe, expect, it } from "vitest";

import { createFakeStore, makeStudent } from "./fake-store.ts";

/**
 * The fake store is the only thing standing behind every handler test, so a
 * fake that is more forgiving than Postgres makes those tests prove less than
 * they look like they prove. These assert the places the two could drift.
 */
describe("fake store fidelity to the real schema", () => {
  it("nulls the student id on existing audit rows when a student is deleted", async () => {
    // The migration's FK is `on delete set null`, verified by execution in
    // schema.test.ts. The fake used to leave studentId intact, so a test
    // asserting "the audit trail still names the child" would have passed here
    // and been false in production.
    const store = createFakeStore([makeStudent({ id: "cohen" })]);
    await store.logEvent({
      studentId: "cohen",
      changedTo: "arrived",
      source: "voice",
      matchConfidence: 0.9,
      rawTranscript: "Cohen",
    });

    await store.removeStudent("cohen");

    expect(store.events).toHaveLength(1);
    expect(store.events[0].studentId).toBeNull();
  });

  it("keeps the rest of the audit row intact after the student is gone", async () => {
    const store = createFakeStore([makeStudent({ id: "cohen" })]);
    await store.logEvent({
      studentId: "cohen",
      changedTo: "arrived",
      source: "voice",
      matchConfidence: 0.9,
      rawTranscript: "Cohen",
    });

    await store.removeStudent("cohen");

    expect(store.events[0]).toMatchObject({
      changedTo: "arrived",
      source: "voice",
      rawTranscript: "Cohen",
    });
  });

  it("leaves other students' audit rows alone", async () => {
    const store = createFakeStore([
      makeStudent({ id: "cohen" }),
      makeStudent({ id: "ng" }),
    ]);
    await store.logEvent({
      studentId: "ng",
      changedTo: "arrived",
      source: "manual",
      matchConfidence: null,
      rawTranscript: null,
    });

    await store.removeStudent("cohen");

    expect(store.events[0].studentId).toBe("ng");
  });

  it("setStatus is a compare-and-set, the way the neq clause is", async () => {
    const store = createFakeStore([
      makeStudent({ id: "cohen", status: "waiting" }),
    ]);

    await expect(store.setStatus("cohen", "arrived")).resolves.not.toBeNull();
    // Second confirmation of the same child changes nothing and returns null,
    // which is what makes the endpoint idempotent and the display flash once.
    await expect(store.setStatus("cohen", "arrived")).resolves.toBeNull();
  });
});
