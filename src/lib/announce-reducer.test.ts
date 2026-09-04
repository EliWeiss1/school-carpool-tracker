import { describe, expect, it } from "vitest";

import {
  announceReducer,
  candidateKey,
  candidateLabel,
  initialAnnounceState,
  type ResolveCandidateLike,
} from "./announce-reducer";

const student = (id: string, overrides: Partial<ResolveCandidateLike["students"][number]> = {}) => ({
  id,
  first_name: "Maya",
  last_name: "Cohen",
  grade: "K",
  class_group: "K-Alvarez",
  status: "waiting" as const,
  ...overrides,
});

const candidate = (
  id: string,
  overrides: Partial<ResolveCandidateLike["students"][number]> = {},
): ResolveCandidateLike => ({
  students: [student(id, overrides)],
  carpool: null,
  score: 0.93,
  matchedOn: "Cohen",
  matchedVia: "surname",
});

const carpoolCandidate = (
  carpoolId: string,
  name: string,
  memberIds: string[],
): ResolveCandidateLike => ({
  students: memberIds.map((id) => student(id)),
  carpool: { id: carpoolId, name },
  score: 0.95,
  matchedOn: name,
  matchedVia: "surname",
});

describe("candidateKey / candidateLabel", () => {
  it("keys and labels a lone student by their own id and name", () => {
    const c = candidate("s1", { first_name: "Maya", last_name: "Cohen" });
    expect(candidateKey(c)).toBe("student:s1");
    expect(candidateLabel(c)).toBe("Maya Cohen");
  });

  it("keys and labels a carpool by its own id and name, not a member's", () => {
    const c = carpoolCandidate("weiss", "Weiss Carpool", ["s1", "s2"]);
    expect(candidateKey(c)).toBe("carpool:weiss");
    expect(candidateLabel(c)).toBe("Weiss Carpool");
  });
});

describe("initialAnnounceState", () => {
  it("starts idle, with no results, no banner, no undo, empty filter and search text", () => {
    const state = initialAnnounceState();

    expect(state.micStatus).toBe("idle");
    expect(state.resolving).toBe(false);
    expect(state.results).toBeNull();
    expect(state.confirmingKey).toBeNull();
    expect(state.banner).toBeNull();
    expect(state.info).toBeNull();
    expect(state.undo).toBeNull();
    expect(state.filter).toEqual({ grade: "", classGroup: "" });
    expect(state.searchText).toBe("");
    expect(state.multiSelect).toBe(false);
    expect(state.selectedKeys).toEqual([]);
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
    expect(state.selectedKeys).toEqual([]);
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

describe("multi-select", () => {
  it("is off by default and toggling it on/off clears any selection", () => {
    let state = initialAnnounceState();
    state = announceReducer(state, {
      type: "candidate/toggleSelect",
      key: "student:s1",
    });
    state = announceReducer(state, { type: "multiSelect/toggle" });

    expect(state.multiSelect).toBe(true);
    expect(state.selectedKeys).toEqual([]);
  });

  it("toggles a candidate key in and out of the selection", () => {
    let state = initialAnnounceState();
    state = announceReducer(state, { type: "multiSelect/toggle" });
    state = announceReducer(state, {
      type: "candidate/toggleSelect",
      key: "student:s1",
    });
    state = announceReducer(state, {
      type: "candidate/toggleSelect",
      key: "student:s2",
    });
    expect(state.selectedKeys).toEqual(["student:s1", "student:s2"]);

    state = announceReducer(state, {
      type: "candidate/toggleSelect",
      key: "student:s1",
    });
    expect(state.selectedKeys).toEqual(["student:s2"]);
  });

  it("a new resolve result clears any prior selection", () => {
    let state = initialAnnounceState();
    state = announceReducer(state, { type: "multiSelect/toggle" });
    state = announceReducer(state, {
      type: "candidate/toggleSelect",
      key: "student:s1",
    });
    state = announceReducer(state, {
      type: "resolve/success",
      origin: "voice",
      tier: "ambiguous",
      transcript: "Cohen",
      candidates: [candidate("s1")],
    });

    expect(state.selectedKeys).toEqual([]);
  });
});

describe("confirming a candidate", () => {
  it("confirm/start records which candidate key is in flight and clears the banner", () => {
    let state = initialAnnounceState();
    state = announceReducer(state, { type: "confirm/start", key: "student:s1" });

    expect(state.confirmingKey).toBe("student:s1");
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
    state = announceReducer(state, { type: "confirm/start", key: "student:s1" });
    state = announceReducer(state, {
      type: "confirm/settled",
      studentIds: ["s1"],
      changedIds: ["s1"],
      displayName: "Maya Cohen",
      carpoolId: null,
      logged: 1,
      confirmedAt: 1_000,
    });

    expect(state.confirmingKey).toBeNull();
    expect(state.results).toBeNull();
    expect(state.undo).toEqual({
      studentIds: ["s1"],
      displayName: "Maya Cohen",
      carpoolId: null,
      confirmedAt: 1_000,
    });
    expect(state.info).toMatch(/Maya Cohen/);
    expect(state.banner).toBeNull();
  });

  it("no changed ids is reported calmly and does not start an undo window", () => {
    let state = initialAnnounceState();
    state = announceReducer(state, { type: "confirm/start", key: "student:s1" });
    state = announceReducer(state, {
      type: "confirm/settled",
      studentIds: ["s1"],
      changedIds: [],
      displayName: "Maya Cohen",
      carpoolId: null,
      logged: 0,
      confirmedAt: 1_000,
    });

    expect(state.undo).toBeNull();
    expect(state.banner).toBeNull();
    expect(state.info).toMatch(/already/i);
  });

  it("logged fewer than changed surfaces a quiet warning but keeps the undo window", () => {
    let state = initialAnnounceState();
    state = announceReducer(state, { type: "confirm/start", key: "student:s1" });
    state = announceReducer(state, {
      type: "confirm/settled",
      studentIds: ["s1"],
      changedIds: ["s1"],
      displayName: "Maya Cohen",
      carpoolId: null,
      logged: 0,
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
      studentIds: ["s0"],
      changedIds: ["s0"],
      displayName: "Earlier Kid",
      carpoolId: null,
      logged: 1,
      confirmedAt: 500,
    });
    state = announceReducer(state, { type: "confirm/start", key: "student:s1" });
    state = announceReducer(state, {
      type: "confirm/error",
      banner: { tone: "error", message: "Too many requests just now." },
    });

    expect(state.confirmingKey).toBeNull();
    expect(state.banner?.message).toBe("Too many requests just now.");
    expect(state.undo?.studentIds).toEqual(["s0"]);
  });

  describe("a whole carpool confirmed in one tap", () => {
    it("all members changed reads as one plural confirmation", () => {
      let state = initialAnnounceState();
      state = announceReducer(state, {
        type: "confirm/settled",
        studentIds: ["s1", "s2"],
        changedIds: ["s1", "s2"],
        displayName: "Weiss Carpool",
        carpoolId: "weiss",
        logged: 2,
        confirmedAt: 1_000,
      });

      expect(state.undo).toEqual({
        studentIds: ["s1", "s2"],
        displayName: "Weiss Carpool",
        carpoolId: "weiss",
        confirmedAt: 1_000,
      });
      expect(state.info).toMatch(/Weiss Carpool/);
      expect(state.info).toMatch(/are marked arrived/);
    });

    it("a partial confirmation (one member already arrived) is calm, not an error, and still opens undo for the ones that changed", () => {
      let state = initialAnnounceState();
      state = announceReducer(state, {
        type: "confirm/settled",
        studentIds: ["s1", "s2"],
        changedIds: ["s2"],
        displayName: "Weiss Carpool",
        carpoolId: "weiss",
        logged: 1,
        confirmedAt: 1_000,
      });

      expect(state.banner).toBeNull();
      expect(state.info).toMatch(/1 of 2/);
      expect(state.undo?.studentIds).toEqual(["s2"]);
    });
  });
});

describe("undo", () => {
  function withUndo() {
    let state = initialAnnounceState();
    state = announceReducer(state, {
      type: "confirm/settled",
      studentIds: ["s1"],
      changedIds: ["s1"],
      displayName: "Maya Cohen",
      carpoolId: null,
      logged: 1,
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
    state = announceReducer(state, { type: "undo/expire", studentIds: ["s1"] });

    expect(state.undo).toBeNull();
    expect(state.banner).toBeNull();
  });

  it("undo/expire is a no-op if a newer confirmation has already replaced the one that expired", () => {
    let state = withUndo();
    // A stale timer for s1 fires after s2 has already been confirmed.
    state = announceReducer(state, {
      type: "confirm/settled",
      studentIds: ["s2"],
      changedIds: ["s2"],
      displayName: "Elias Kohen",
      carpoolId: null,
      logged: 1,
      confirmedAt: 2_000,
    });
    state = announceReducer(state, { type: "undo/expire", studentIds: ["s1"] });

    expect(state.undo?.studentIds).toEqual(["s2"]);
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
