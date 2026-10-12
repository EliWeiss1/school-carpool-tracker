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
const prompt = (state: AnnounceState, studentId: string) =>
  announceReducer(state, { type: "pad/promptCarpool", studentId });

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
      logged: 2,
    });

    expect(state.pad.selection).toEqual({ K1: ["c"] });
    expect(state.pad.openClass).toBe("K1");
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

describe("carpool prompt", () => {
  it("opens with everyone ticked", () => {
    const state = prompt(open(initialAnnounceState(), "K1"), "a");

    expect(state.pad.carpoolPrompt).toEqual({ studentId: "a", unchecked: [] });
  });

  it("un-ticks and re-ticks a member", () => {
    let state = prompt(initialAnnounceState(), "a");
    state = announceReducer(state, { type: "pad/promptToggle", studentId: "b" });
    expect(state.pad.carpoolPrompt?.unchecked).toEqual(["b"]);

    state = announceReducer(state, { type: "pad/promptToggle", studentId: "b" });
    expect(state.pad.carpoolPrompt?.unchecked).toEqual([]);
  });

  it("toggling with no prompt open does nothing", () => {
    const before = initialAnnounceState();
    expect(
      announceReducer(before, { type: "pad/promptToggle", studentId: "b" }),
    ).toBe(before);
  });

  it("cancelling selects nobody", () => {
    let state = prompt(initialAnnounceState(), "a");
    state = announceReducer(state, { type: "pad/promptCancel" });

    expect(state.pad.carpoolPrompt).toBeNull();
    expect(state.pad.selection).toEqual({});
  });

  it("confirming adds every pick, across classes, and closes the prompt", () => {
    let state = pick(initialAnnounceState(), "K1", "a");
    state = prompt(state, "b");
    state = announceReducer(state, {
      type: "pad/selectMany",
      picks: [
        { classGroup: "K1", studentId: "a" },
        { classGroup: "K1", studentId: "b" },
        { classGroup: "3rd", studentId: "c" },
      ],
    });

    expect(state.pad.carpoolPrompt).toBeNull();
    // "a" was already picked and is not doubled.
    expect(state.pad.selection).toEqual({ K1: ["a", "b"], "3rd": ["c"] });
  });

  it("closing the drawer, searching, or narrowing dismisses the prompt", () => {
    const withPrompt = () => prompt(open(initialAnnounceState(), "K1"), "a");

    expect(
      announceReducer(withPrompt(), { type: "pad/close" }).pad.carpoolPrompt,
    ).toBeNull();
    expect(
      announceReducer(withPrompt(), { type: "resolve/start" }).pad.carpoolPrompt,
    ).toBeNull();
    expect(narrow(withPrompt(), "K1").pad.carpoolPrompt).toBeNull();
  });
});
