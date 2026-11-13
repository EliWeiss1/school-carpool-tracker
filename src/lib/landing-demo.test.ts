import { describe, expect, it } from "vitest";

import {
  DEMO_CALL_ORDER,
  DEMO_CHILDREN,
  advanceDemo,
  childBeingCalled,
  demoStepDelayMs,
  demoTiles,
  initialDemoState,
  stillDemoState,
  type DemoState,
} from "./landing-demo";

/** Every state of one full loop, starting from the initial one. */
function fullLoop(): DemoState[] {
  const states = [initialDemoState()];
  // listening -> heard -> confirmed per scripted child.
  for (let i = 0; i < DEMO_CALL_ORDER.length * 3 - 1; i++) {
    states.push(advanceDemo(states[states.length - 1]));
  }
  return states;
}

describe("the landing page pickup demo", () => {
  it("starts with nobody arrived, listening for the first scripted child", () => {
    const state = initialDemoState();
    expect(state.phase).toBe("listening");
    expect(state.arrivedIds).toEqual([]);
    expect(state.flashingId).toBeNull();
    expect(childBeingCalled(state).id).toBe(DEMO_CALL_ORDER[0]);
  });

  it("hears a name before anything changes on the board", () => {
    const heard = advanceDemo(initialDemoState());
    expect(heard.phase).toBe("heard");
    expect(heard.arrivedIds).toEqual([]);
    expect(childBeingCalled(heard).id).toBe(DEMO_CALL_ORDER[0]);
  });

  it("marks the child arrived, and flashing, only on the confirm step", () => {
    const confirmed = advanceDemo(advanceDemo(initialDemoState()));
    expect(confirmed.phase).toBe("confirmed");
    expect(confirmed.arrivedIds).toEqual([DEMO_CALL_ORDER[0]]);
    expect(confirmed.flashingId).toBe(DEMO_CALL_ORDER[0]);
  });

  it("moves on to the next child and keeps earlier arrivals", () => {
    let state = initialDemoState();
    for (let i = 0; i < 3; i++) state = advanceDemo(state);
    expect(state.phase).toBe("listening");
    expect(childBeingCalled(state).id).toBe(DEMO_CALL_ORDER[1]);
    expect(state.arrivedIds).toEqual([DEMO_CALL_ORDER[0]]);
  });

  // The product's one non-negotiable, kept true even in the marketing loop:
  // a name never reaches the board without the confirm step in between.
  it("never shows an arrival that was not heard first", () => {
    const states = fullLoop();
    for (let i = 1; i < states.length; i++) {
      const added = states[i].arrivedIds.filter(
        (id) => !states[i - 1].arrivedIds.includes(id),
      );
      if (added.length === 0) continue;
      expect(added).toHaveLength(1);
      expect(states[i - 1].phase).toBe("heard");
      expect(childBeingCalled(states[i - 1]).id).toBe(added[0]);
    }
  });

  it("leaves some children waiting, then starts over", () => {
    const states = fullLoop();
    const last = states[states.length - 1];
    expect(last.phase).toBe("confirmed");
    expect(last.arrivedIds).toHaveLength(DEMO_CALL_ORDER.length);
    expect(DEMO_CALL_ORDER.length).toBeLessThan(DEMO_CHILDREN.length);
    expect(advanceDemo(last)).toEqual(initialDemoState());
  });

  it("only ever calls children who are on the demo roster, once each", () => {
    const ids = DEMO_CHILDREN.map((child) => child.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(DEMO_CALL_ORDER).size).toBe(DEMO_CALL_ORDER.length);
    for (const id of DEMO_CALL_ORDER) expect(ids).toContain(id);
  });

  it("turns the state into board tiles in roster order", () => {
    const confirmed = advanceDemo(advanceDemo(initialDemoState()));
    const tiles = demoTiles(confirmed);
    expect(tiles.map((tile) => tile.student.id)).toEqual(
      DEMO_CHILDREN.map((child) => child.id),
    );
    for (const tile of tiles) {
      const arrived = tile.student.id === DEMO_CALL_ORDER[0];
      expect(tile.student.status).toBe(arrived ? "arrived" : "waiting");
      expect(tile.flashing).toBe(arrived);
    }
  });

  it("holds the confirm step longest, so the flash can be seen", () => {
    expect(demoStepDelayMs("confirmed")).toBeGreaterThan(
      demoStepDelayMs("heard"),
    );
    expect(demoStepDelayMs("heard")).toBeGreaterThan(0);
    expect(demoStepDelayMs("listening")).toBeGreaterThan(0);
  });

  it("has a still frame for reduced motion: a mix of statuses, mid-confirm, nothing flashing", () => {
    const still = stillDemoState();
    expect(still.phase).toBe("heard");
    expect(still.flashingId).toBeNull();
    expect(still.arrivedIds.length).toBeGreaterThan(0);
    expect(still.arrivedIds.length).toBeLessThan(DEMO_CHILDREN.length);
    expect(still.arrivedIds).not.toContain(childBeingCalled(still).id);
  });
});
