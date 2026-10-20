import { describe, expect, it } from "vitest";

import {
  announceReducer,
  candidateKey,
  candidateLabel,
  effectiveMemberIds,
  initialAnnounceState,
  type ResolveCandidateLike,
} from "./announce-reducer";

const student = (id: string, overrides: Partial<ResolveCandidateLike["students"][number]> = {}) => ({
  id,
  first_name: "Maya",
  last_name: "Cohen",
  class_group: "K1",
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
  it("starts idle, with no results, no banner, empty filter and search text", () => {
    const state = initialAnnounceState();

    expect(state.micStatus).toBe("idle");
    expect(state.resolving).toBe(false);
    expect(state.results).toBeNull();
    expect(state.confirmingKey).toBeNull();
    expect(state.banner).toBeNull();
    expect(state.info).toBeNull();
    expect(state.filter).toEqual({ classGroups: [] });
    expect(state.pad).toEqual({
      openClass: null,
      selection: {},
      carpoolPrompt: null,
    });
    expect(state.searchText).toBe("");
    expect(state.multiSelect).toBe(false);
    expect(state.selectedKeys).toEqual([]);
  });
});

describe("filter and search text", () => {
  const toggle = (
    state: ReturnType<typeof initialAnnounceState>,
    classGroup: string,
  ) => announceReducer(state, { type: "filter/toggleClass", classGroup });

  it("narrows to several classes at once", () => {
    let state = initialAnnounceState();
    state = toggle(state, "3rd");
    state = toggle(state, "K1");

    expect(state.filter).toEqual({ classGroups: ["3rd", "K1"] });
  });

  it("toggling a class that is already on takes it off", () => {
    let state = toggle(toggle(initialAnnounceState(), "3rd"), "K1");
    state = toggle(state, "3rd");

    expect(state.filter).toEqual({ classGroups: ["K1"] });
  });

  it("clearing goes back to any class", () => {
    let state = toggle(initialAnnounceState(), "3rd");
    state = announceReducer(state, { type: "filter/clear" });

    expect(state.filter).toEqual({ classGroups: [] });
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

    state = toggle(state, "1st");

    expect(state.results).toBeNull();
  });

  it("tracks the typed search box", () => {
    let state = initialAnnounceState();
    state = announceReducer(state, { type: "search/change", value: "Coh" });
    expect(state.searchText).toBe("Coh");
  });
});

describe("live search suggestions", () => {
  const suggestions = (...candidates: ResolveCandidateLike[]) => ({
    tier: candidates.length === 1 ? ("clear" as const) : ("ambiguous" as const),
    candidates,
  });

  it("shows suggestions as a live, typed result", () => {
    const state = announceReducer(initialAnnounceState(), {
      type: "search/change",
      value: " Coh ",
      suggestions: suggestions(candidate("s1"), candidate("s2")),
    });
    expect(state.searchText).toBe(" Coh ");
    expect(state.results).toMatchObject({
      origin: "manual",
      tier: "ambiguous",
      transcript: "Coh",
      live: true,
    });
    expect(state.results?.candidates).toHaveLength(2);
  });

  it("keeps picks and carpool exclusions only for candidates still shown", () => {
    const carpool = carpoolCandidate("c1", "Cohen Carpool", ["s2", "s3"]);
    let state = announceReducer(initialAnnounceState(), {
      type: "search/change",
      value: "Co",
      suggestions: suggestions(candidate("s1"), carpool),
    });
    state = announceReducer(state, { type: "multiSelect/toggle" });
    state = announceReducer(state, { type: "candidate/toggleSelect", key: "student:s1" });
    state = announceReducer(state, { type: "candidate/toggleSelect", key: "carpool:c1" });
    state = announceReducer(state, {
      type: "candidate/toggleMember",
      candidateKey: "carpool:c1",
      studentId: "s3",
    });

    state = announceReducer(state, {
      type: "search/change",
      value: "Coh",
      suggestions: suggestions(carpool),
    });

    expect(state.selectedKeys).toEqual(["carpool:c1"]);
    expect(state.excludedMemberIds).toEqual({ "carpool:c1": ["s3"] });
  });

  it("clears typed suggestions when the box is emptied", () => {
    let state = announceReducer(initialAnnounceState(), {
      type: "search/change",
      value: "Co",
      suggestions: suggestions(candidate("s1")),
    });
    state = announceReducer(state, {
      type: "search/change",
      value: "",
      suggestions: { tier: "none", candidates: [] },
    });
    expect(state.results).toBeNull();
  });

  it("does not throw away a voice result when the box is emptied", () => {
    let state = announceReducer(initialAnnounceState(), {
      type: "resolve/success",
      origin: "voice",
      tier: "clear",
      transcript: "Cohen",
      candidates: [candidate("s1")],
    });
    state = announceReducer(state, {
      type: "search/change",
      value: "",
      suggestions: { tier: "none", candidates: [] },
    });
    expect(state.results?.origin).toBe("voice");
  });

  it("empties the box after a confirm, ready for the next name", () => {
    let state = announceReducer(initialAnnounceState(), {
      type: "search/change",
      value: "Cohen",
      suggestions: suggestions(candidate("s1")),
    });
    state = announceReducer(state, { type: "confirm/start", key: "student:s1" });
    state = announceReducer(state, {
      type: "confirm/settled",
      studentIds: ["s1"],
      changedIds: ["s1"],
      displayName: "Maya Cohen",
      logged: 1,
    });
    expect(state.searchText).toBe("");
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

describe("carpool member exclusion", () => {
  it("effectiveMemberIds returns everyone for a candidate never touched", () => {
    const c = carpoolCandidate("weiss", "Weiss Carpool", ["s1", "s2"]);
    expect(effectiveMemberIds(c, {})).toEqual(["s1", "s2"]);
  });

  it("candidate/toggleMember excludes a member from that candidate's confirm", () => {
    let state = initialAnnounceState();
    state = announceReducer(state, {
      type: "candidate/toggleMember",
      candidateKey: "carpool:weiss",
      studentId: "s2",
    });

    const c = carpoolCandidate("weiss", "Weiss Carpool", ["s1", "s2"]);
    expect(effectiveMemberIds(c, state.excludedMemberIds)).toEqual(["s1"]);
  });

  it("toggling the same member twice re-includes them", () => {
    let state = initialAnnounceState();
    state = announceReducer(state, {
      type: "candidate/toggleMember",
      candidateKey: "carpool:weiss",
      studentId: "s2",
    });
    state = announceReducer(state, {
      type: "candidate/toggleMember",
      candidateKey: "carpool:weiss",
      studentId: "s2",
    });

    const c = carpoolCandidate("weiss", "Weiss Carpool", ["s1", "s2"]);
    expect(effectiveMemberIds(c, state.excludedMemberIds)).toEqual([
      "s1",
      "s2",
    ]);
  });

  it("only excludes from the candidate it was toggled on, not other carpools", () => {
    let state = initialAnnounceState();
    state = announceReducer(state, {
      type: "candidate/toggleMember",
      candidateKey: "carpool:weiss",
      studentId: "s2",
    });

    const other = carpoolCandidate("other", "Other Carpool", ["s2", "s3"]);
    expect(effectiveMemberIds(other, state.excludedMemberIds)).toEqual([
      "s2",
      "s3",
    ]);
  });

  it("a new resolve result clears any prior exclusion", () => {
    let state = initialAnnounceState();
    state = announceReducer(state, {
      type: "candidate/toggleMember",
      candidateKey: "carpool:weiss",
      studentId: "s2",
    });
    state = announceReducer(state, {
      type: "resolve/success",
      origin: "voice",
      tier: "clear",
      transcript: "Weiss Carpool",
      candidates: [carpoolCandidate("weiss", "Weiss Carpool", ["s1", "s2"])],
    });

    expect(state.excludedMemberIds).toEqual({});
  });

  it("a settled confirm clears the exclusion, so it never leaks into the next resolve", () => {
    let state = initialAnnounceState();
    state = announceReducer(state, {
      type: "candidate/toggleMember",
      candidateKey: "carpool:weiss",
      studentId: "s2",
    });
    state = announceReducer(state, {
      type: "confirm/settled",
      studentIds: ["s1"],
      changedIds: ["s1"],
      displayName: "Weiss Carpool",
      logged: 1,
    });

    expect(state.excludedMemberIds).toEqual({});
  });
});

describe("confirming a candidate", () => {
  it("confirm/start records which candidate key is in flight and clears the banner", () => {
    let state = initialAnnounceState();
    state = announceReducer(state, { type: "confirm/start", key: "student:s1" });

    expect(state.confirmingKey).toBe("student:s1");
    expect(state.banner).toBeNull();
  });

  it("a changed confirmation clears results and stops the in-flight flag", () => {
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
      logged: 1,
    });

    expect(state.confirmingKey).toBeNull();
    expect(state.results).toBeNull();
    expect(state.info).toMatch(/Maya Cohen/);
    expect(state.banner).toBeNull();
  });

  it("no changed ids is reported calmly", () => {
    let state = initialAnnounceState();
    state = announceReducer(state, { type: "confirm/start", key: "student:s1" });
    state = announceReducer(state, {
      type: "confirm/settled",
      studentIds: ["s1"],
      changedIds: [],
      displayName: "Maya Cohen",
      logged: 0,
    });

    expect(state.banner).toBeNull();
    expect(state.info).toMatch(/already/i);
  });

  it("logged fewer than changed surfaces a quiet warning", () => {
    let state = initialAnnounceState();
    state = announceReducer(state, { type: "confirm/start", key: "student:s1" });
    state = announceReducer(state, {
      type: "confirm/settled",
      studentIds: ["s1"],
      changedIds: ["s1"],
      displayName: "Maya Cohen",
      logged: 0,
    });

    expect(state.banner).toEqual({
      tone: "warning",
      message: expect.stringMatching(/log/i),
    });
  });

  it("confirm/error stops the in-flight flag and shows the banner", () => {
    let state = initialAnnounceState();
    state = announceReducer(state, {
      type: "confirm/settled",
      studentIds: ["s0"],
      changedIds: ["s0"],
      displayName: "Earlier Kid",
      logged: 1,
    });
    state = announceReducer(state, { type: "confirm/start", key: "student:s1" });
    state = announceReducer(state, {
      type: "confirm/error",
      banner: { tone: "error", message: "Too many requests just now." },
    });

    expect(state.confirmingKey).toBeNull();
    expect(state.banner?.message).toBe("Too many requests just now.");
  });

  describe("a whole carpool confirmed in one tap", () => {
    it("all members changed reads as one plural confirmation", () => {
      let state = initialAnnounceState();
      state = announceReducer(state, {
        type: "confirm/settled",
        studentIds: ["s1", "s2"],
        changedIds: ["s1", "s2"],
        displayName: "Weiss Carpool",
        logged: 2,
      });

      expect(state.info).toMatch(/Weiss Carpool/);
      expect(state.info).toMatch(/are marked arrived/);
    });

    it("a partial confirmation (one member already arrived) is calm, not an error", () => {
      let state = initialAnnounceState();
      state = announceReducer(state, {
        type: "confirm/settled",
        studentIds: ["s1", "s2"],
        changedIds: ["s2"],
        displayName: "Weiss Carpool",
        logged: 1,
      });

      expect(state.banner).toBeNull();
      expect(state.info).toMatch(/1 of 2/);
    });
  });
});

describe("sending someone back to waiting", () => {
  it("unannounce/settled clears the in-flight flag and says so calmly", () => {
    let state = initialAnnounceState();
    state = announceReducer(state, { type: "confirm/start", key: "unannounce:s1" });
    state = announceReducer(state, {
      type: "unannounce/settled",
      displayName: "Maya Cohen",
    });

    expect(state.confirmingKey).toBeNull();
    expect(state.banner).toBeNull();
    expect(state.info).toBe("Maya Cohen is back to waiting.");
  });

  it("a failed attempt keeps everything and shows the banner", () => {
    let state = initialAnnounceState();
    state = announceReducer(state, { type: "confirm/start", key: "unannounce:s1" });
    state = announceReducer(state, {
      type: "confirm/error",
      banner: { tone: "error", message: "Could not connect." },
    });

    expect(state.confirmingKey).toBeNull();
    expect(state.banner?.message).toBe("Could not connect.");
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
