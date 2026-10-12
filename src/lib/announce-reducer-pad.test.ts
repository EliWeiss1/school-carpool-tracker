import { describe, expect, it } from "vitest";

import {
  type AnnounceState,
  announceReducer,
  initialAnnounceState,
} from "./announce-reducer";

/** Tiny action helpers so each test reads as the story it tells. */
const open = (state: AnnounceState, classGroup: string) =>
  announceReducer(state, { type: "pad/open", classGroup });
const pick = (state: AnnounceState, classGroup: string, studentId: string) =>
  announceReducer(state, { type: "pad/toggleStudent", classGroup, studentId });
const narrow = (state: AnnounceState, classGroup: string) =>
  announceReducer(state, { type: "filter/toggleClass", classGroup });

describe("class drawer", () => {
  it("opens, switches class, and closes without losing picks", () => {
    let state = open(initialAnnounceState(), "K1");
    state = pick(state, "K1", "a");
    state = open(state, "2nd");
    state = pick(state, "2nd", "b");
    state = announceReducer(state, { type: "pad/close" });

    expect(state.pad.openClass).toBeNull();
    expect(state.pad.selection).toEqual({ K1: ["a"], "2nd": ["b"] });
  });

  it("a second tap on the same student unselects them", () => {
    let state = pick(initialAnnounceState(), "K1", "a");
    state = pick(state, "K1", "a");

    expect(state.pad.selection).toEqual({});
  });

  it("clears every pick on request", () => {
    let state = pick(pick(initialAnnounceState(), "K1", "a"), "2nd", "b");
    state = announceReducer(state, { type: "pad/clearSelection" });

    expect(state.pad.selection).toEqual({});
  });

  it("narrowing a class out closes its drawer and drops only its picks", () => {
    let state = narrow(narrow(initialAnnounceState(), "K1"), "2nd");
    state = pick(pick(open(state, "K1"), "K1", "a"), "2nd", "b");

    state = narrow(state, "K1");

    expect(state.pad.openClass).toBeNull();
    expect(state.pad.selection).toEqual({ "2nd": ["b"] });
  });

  it("narrowing a different class out leaves an open drawer alone", () => {
    let state = narrow(narrow(initialAnnounceState(), "K1"), "2nd");
    state = open(state, "K1");

    state = narrow(state, "2nd");

    expect(state.pad.openClass).toBe("K1");
  });

  it("going back to any class keeps every pick, since every class is offered", () => {
    let state = narrow(initialAnnounceState(), "K1");
    state = pick(open(state, "K1"), "K1", "a");

    state = announceReducer(state, { type: "filter/clear" });

    expect(state.pad.openClass).toBe("K1");
    expect(state.pad.selection).toEqual({ K1: ["a"] });
  });

  it("a search steps the drawer aside but keeps the picks", () => {
    let state = pick(open(initialAnnounceState(), "K1"), "K1", "a");
    state = announceReducer(state, { type: "resolve/start" });

    expect(state.pad.openClass).toBeNull();
    expect(state.pad.selection).toEqual({ K1: ["a"] });
  });

  it("an announce removes exactly the ids it covered, from every class, and keeps the drawer open", () => {
    let state = open(initialAnnounceState(), "K1");
    state = pick(pick(pick(state, "K1", "a"), "K1", "c"), "2nd", "b");

    state = announceReducer(state, {
      type: "confirm/settled",
      studentIds: ["a", "b"],
      changedIds: ["a", "b"],
      displayName: "Maya Cohen, Elias Kohen",
      carpoolId: null,
      logged: 2,
      confirmedAt: 1,
    });

    expect(state.pad.selection).toEqual({ K1: ["c"] });
    expect(state.pad.openClass).toBe("K1");
    expect(state.undo?.studentIds).toEqual(["a", "b"]);
  });

  it("a failed announce keeps every pick so the retry is one tap", () => {
    let state = pick(initialAnnounceState(), "K1", "a");
    state = announceReducer(state, {
      type: "confirm/error",
      banner: { tone: "error", message: "Offline." },
    });

    expect(state.pad.selection).toEqual({ K1: ["a"] });
  });
});
