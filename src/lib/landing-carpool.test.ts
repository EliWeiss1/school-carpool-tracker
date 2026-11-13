import { describe, expect, it } from "vitest";

import {
  announceCarpool,
  announceLabel,
  CARPOOL_BOARD,
  CARPOOL_RIDER_IDS,
  carpoolTiles,
  initialCarpoolDemo,
  isRiding,
  resetCarpoolDemo,
  toggleRider,
} from "./landing-carpool";

const [first, second, third] = CARPOOL_RIDER_IDS;

describe("the landing page's carpool demo", () => {
  it("starts with the whole carpool ticked and nobody called", () => {
    const state = initialCarpoolDemo();

    expect(CARPOOL_RIDER_IDS.every((id) => isRiding(state, id))).toBe(true);
    expect(state.announced).toBe(false);
    expect(
      carpoolTiles(state).every((tile) => tile.student.status === "waiting"),
    ).toBe(true);
  });

  it("names riders who are all on the board, among other children", () => {
    const boardIds = CARPOOL_BOARD.map((child) => child.id);
    expect(CARPOOL_RIDER_IDS.length).toBeGreaterThanOrEqual(3);
    for (const id of CARPOOL_RIDER_IDS) expect(boardIds).toContain(id);
    // A board of only the carpool would not show that the others stay put.
    expect(boardIds.length).toBeGreaterThan(CARPOOL_RIDER_IDS.length);
  });

  it("unticks and re-ticks a rider", () => {
    const without = toggleRider(initialCarpoolDemo(), second);
    expect(isRiding(without, second)).toBe(false);
    expect(isRiding(without, first)).toBe(true);

    expect(isRiding(toggleRider(without, second), second)).toBe(true);
  });

  it("ignores a toggle for a child who is not in the carpool", () => {
    const state = initialCarpoolDemo();
    expect(toggleRider(state, "someone-else")).toEqual(state);
  });

  it("announces exactly the ticked riders and nobody else", () => {
    const state = announceCarpool(toggleRider(initialCarpoolDemo(), third));
    const arrived = carpoolTiles(state)
      .filter((tile) => tile.student.status === "arrived")
      .map((tile) => tile.student.id);

    expect(arrived.sort()).toEqual([first, second].sort());
    expect(state.announced).toBe(true);
  });

  it("flashes the riders it just announced, and only them", () => {
    const state = announceCarpool(toggleRider(initialCarpoolDemo(), third));
    const flashing = carpoolTiles(state)
      .filter((tile) => tile.flashing)
      .map((tile) => tile.student.id);

    expect(flashing.sort()).toEqual([first, second].sort());
  });

  it("does not announce an empty carpool", () => {
    let state = initialCarpoolDemo();
    for (const id of CARPOOL_RIDER_IDS) state = toggleRider(state, id);

    expect(announceCarpool(state)).toEqual(state);
    expect(announceCarpool(state).announced).toBe(false);
  });

  it("locks the ticks once announced, the way a sent announcement is sent", () => {
    const sent = announceCarpool(initialCarpoolDemo());
    expect(toggleRider(sent, first)).toEqual(sent);
    expect(announceCarpool(sent)).toEqual(sent);
  });

  it("starts over", () => {
    const sent = announceCarpool(toggleRider(initialCarpoolDemo(), first));
    expect(resetCarpoolDemo()).toEqual(initialCarpoolDemo());
    expect(resetCarpoolDemo()).not.toEqual(sent);
  });

  it("words the button by how many will be called", () => {
    const all = initialCarpoolDemo();
    const two = toggleRider(all, first);
    const one = toggleRider(two, second);
    const none = toggleRider(one, third);

    expect(announceLabel(all)).toBe(`Announce ${CARPOOL_RIDER_IDS.length}`);
    expect(announceLabel(two)).toBe(`Announce ${CARPOOL_RIDER_IDS.length - 1}`);
    expect(announceLabel(one)).toBe("Announce 1");
    expect(announceLabel(none)).toBe("Tick a rider");
    expect(announceLabel(announceCarpool(all))).toBe("Announced");
  });
});
