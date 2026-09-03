import { describe, expect, it } from "vitest";

import {
  announceReducer,
  initialAnnounceState,
  type ResolveCandidateLike,
} from "./announce-reducer";

const candidate = (
  id: string,
  overrides: Partial<ResolveCandidateLike["student"]> = {},
): ResolveCandidateLike => ({
  student: {
    id,
    first_name: "Maya",
    last_name: "Cohen",
    grade: "K",
    class_group: "K-Alvarez",
    status: "waiting",
    ...overrides,
  },
  score: 0.93,
  matchedOn: "Cohen",
  matchedVia: "surname",
});

describe("initialAnnounceState", () => {
  it("starts idle, with no results, no banner, no undo, empty filter and search text", () => {
    const state = initialAnnounceState();

    expect(state.micStatus).toBe("idle");
    expect(state.resolving).toBe(false);
    expect(state.results).toBeNull();
    expect(state.confirmingId).toBeNull();
    expect(state.banner).toBeNull();
    expect(state.info).toBeNull();
    expect(state.undo).toBeNull();
    expect(state.filter).toEqual({ grade: "", classGroup: "" });
    expect(state.searchText).toBe("");
  });
});

describe("filter and search text", () => {
  it("updates one filter field without touching the other", () => {
    let state = initialAnnounceState();
    state = announceReducer(state, {
      type: "filter/change",
      field: "grade",
      value: "3",
    });
    state = announceReducer(state, {
      type: "filter/change",
      field: "classGroup",
      value: "3-Diaz",
    });

    expect(state.filter).toEqual({ grade: "3", classGroup: "3-Diaz" });
  });

  it("changing the filter clears stale results so a stale candidate can't be confirmed", () => {
    let state = initialAnnounceState();
    state = announceReducer(state, {
      type: "resolve/success",
      origin: "manual",
      tier: "clear",
      transcript: "Cohen",
      candidates: [candidate("s1")],
    });

    state = announceReducer(state, {
      type: "filter/change",
      field: "grade",
      value: "1",
    });

    expect(state.results).toBeNull();
  });

  it("tracks the typed search box", () => {
    let state = initialAnnounceState();
    state = announceReducer(state, { type: "search/change", value: "Coh" });
    expect(state.searchText).toBe("Coh");
  });
});

describe("mic status", () => {
  it("reflects connecting/listening/processing as reported by the speech source", () => {
    let state = initialAnnounceState();
    state = announceReducer(state, { type: "mic/status", status: "connecting" });
    expect(state.micStatus).toBe("connecting");

    state = announceReducer(state, { type: "mic/status", status: "listening" });
    expect(state.micStatus).toBe("listening");
  });

  it("nothing heard returns the mic to idle, clears results, and leaves a calm hint", () => {
    let state = initialAnnounceState();
    state = announceReducer(state, { type: "mic/status", status: "listening" });
    state = announceReducer(state, { type: "mic/nothingHeard" });

    expect(state.micStatus).toBe("idle");
    expect(state.results).toBeNull();
    expect(state.info).toMatch(/catch|hear/i);
    expect(state.banner).toBeNull();
  });
});

describe("resolving", () => {
  it("resolve/start marks resolving and clears any previous banner", () => {
    let state = initialAnnounceState();
    state = announceReducer(state, {
      type: "resolve/error",
      banner: { tone: "error", message: "boom" },
    });
    state = announceReducer(state, { type: "resolve/start" });

    expect(state.resolving).toBe(true);
    expect(state.banner).toBeNull();
  });

  it("resolve/success stores the tier, transcript, candidates and origin, and stops resolving", () => {
    let state = initialAnnounceState();
    state = announceReducer(state, { type: "resolve/start" });
    state = announceReducer(state, {
      type: "resolve/success",
      origin: "voice",
      tier: "ambiguous",
      transcript: "Coen",
      candidates: [candidate("s1"), candidate("s2")],
    });

    expect(state.resolving).toBe(false);
    expect(state.results).toEqual({
      origin: "voice",
      tier: "ambiguous",
      transcript: "Coen",
      candidates: [candidate("s1"), candidate("s2")],
    });
  });

  it("resolve/error stops resolving, clears results, and sets the banner verbatim", () => {
    let state = initialAnnounceState();
    state = announceReducer(state, { type: "resolve/start" });
    state = announceReducer(state, {
      type: "resolve/error",
      banner: { tone: "error", message: "The board is not reachable right now." },
    });

    expect(state.resolving).toBe(false);
    expect(state.results).toBeNull();
    expect(state.banner).toEqual({
      tone: "error",
      message: "The board is not reachable right now.",
    });
  });

  it("a fresh resolve/start clears a leftover info hint from a previous empty press", () => {
    let state = initialAnnounceState();
    state = announceReducer(state, { type: "mic/nothingHeard" });
    expect(state.info).not.toBeNull();

    state = announceReducer(state, { type: "resolve/start" });
    expect(state.info).toBeNull();
  });
});

describe("confirming a candidate", () => {
  it("confirm/start records which student is in flight and clears the banner", () => {
    let state = initialAnnounceState();
    state = announceReducer(state, { type: "confirm/start", studentId: "s1" });

    expect(state.confirmingId).toBe("s1");
    expect(state.banner).toBeNull();
  });

  it("a changed confirmation clears results, starts the undo window, and stops the in-flight flag", () => {
    let state = initialAnnounceState();
    state = announceReducer(state, {
      type: "resolve/success",
      origin: "voice",
      tier: "clear",
      transcript: "Cohen",
      candidates: [candidate("s1")],
    });
    state = announceReducer(state, { type: "confirm/start", studentId: "s1" });
    state = announceReducer(state, {
      type: "confirm/settled",
      studentId: "s1",
      displayName: "Maya Cohen",
      changed: true,
      logged: true,
      confirmedAt: 1_000,
    });

    expect(state.confirmingId).toBeNull();
    expect(state.results).toBeNull();
    expect(state.undo).toEqual({
      studentId: "s1",
      displayName: "Maya Cohen",
      confirmedAt: 1_000,
    });
    expect(state.info).toMatch(/Maya Cohen/);
    expect(state.banner).toBeNull();
  });

  it("changed: false is reported calmly and does not start an undo window", () => {
    let state = initialAnnounceState();
    state = announceReducer(state, { type: "confirm/start", studentId: "s1" });
    state = announceReducer(state, {
      type: "confirm/settled",
      studentId: "s1",
      displayName: "Maya Cohen",
      changed: false,
      logged: true,
      confirmedAt: 1_000,
    });

    expect(state.undo).toBeNull();
    expect(state.banner).toBeNull();
    expect(state.info).toMatch(/already/i);
  });

  it("logged: false surfaces a quiet warning but keeps the undo window (the write itself stuck)", () => {
    let state = initialAnnounceState();
    state = announceReducer(state, { type: "confirm/start", studentId: "s1" });
    state = announceReducer(state, {
      type: "confirm/settled",
      studentId: "s1",
      displayName: "Maya Cohen",
      changed: true,
      logged: false,
      confirmedAt: 1_000,
    });

    expect(state.undo).not.toBeNull();
    expect(state.banner).toEqual({
      tone: "warning",
      message: expect.stringMatching(/log/i),
    });
  });

  it("confirm/error stops the in-flight flag and shows the banner without touching any existing undo state", () => {
    let state = initialAnnounceState();
    state = announceReducer(state, {
      type: "confirm/settled",
      studentId: "s0",
      displayName: "Earlier Kid",
      changed: true,
      logged: true,
      confirmedAt: 500,
    });
    state = announceReducer(state, { type: "confirm/start", studentId: "s1" });
    state = announceReducer(state, {
      type: "confirm/error",
      banner: { tone: "error", message: "Too many requests just now." },
    });

    expect(state.confirmingId).toBeNull();
    expect(state.banner?.message).toBe("Too many requests just now.");
    expect(state.undo?.studentId).toBe("s0");
  });
});

describe("undo", () => {
  function withUndo() {
    let state = initialAnnounceState();
    state = announceReducer(state, {
      type: "confirm/settled",
      studentId: "s1",
      displayName: "Maya Cohen",
      changed: true,
      logged: true,
      confirmedAt: 1_000,
    });
    return state;
  }

  it("undo/success clears the undo window and confirms in a calm info message", () => {
    let state = withUndo();
    state = announceReducer(state, { type: "undo/success" });

    expect(state.undo).toBeNull();
    expect(state.info).toMatch(/undo|waiting/i);
  });

  it("undo/error keeps the undo window (nothing was undone) and shows the banner", () => {
    let state = withUndo();
    state = announceReducer(state, {
      type: "undo/error",
      banner: { tone: "error", message: "Could not connect." },
    });

    expect(state.undo).not.toBeNull();
    expect(state.banner?.message).toBe("Could not connect.");
  });

  it("undo/expire silently clears an undo window whose time has run out", () => {
    let state = withUndo();
    state = announceReducer(state, { type: "undo/expire", studentId: "s1" });

    expect(state.undo).toBeNull();
    expect(state.banner).toBeNull();
  });

  it("undo/expire is a no-op if a newer confirmation has already replaced the one that expired", () => {
    let state = withUndo();
    // A stale timer for s1 fires after s2 has already been confirmed.
    state = announceReducer(state, {
      type: "confirm/settled",
      studentId: "s2",
      displayName: "Elias Kohen",
      changed: true,
      logged: true,
      confirmedAt: 2_000,
    });
    state = announceReducer(state, { type: "undo/expire", studentId: "s1" });

    expect(state.undo?.studentId).toBe("s2");
  });
});

describe("dismissing messages", () => {
  it("banner/dismiss clears only the banner", () => {
    let state = initialAnnounceState();
    state = announceReducer(state, {
      type: "resolve/error",
      banner: { tone: "error", message: "boom" },
    });
    state = announceReducer(state, { type: "banner/dismiss" });

    expect(state.banner).toBeNull();
  });

  it("info/dismiss clears only the info message", () => {
    let state = initialAnnounceState();
    state = announceReducer(state, { type: "mic/nothingHeard" });
    state = announceReducer(state, { type: "info/dismiss" });

    expect(state.info).toBeNull();
  });
});
