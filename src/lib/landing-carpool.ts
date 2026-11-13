import type { DemoChild, DemoTile } from "@/lib/landing-demo";

/**
 * The landing page's carpool demo: one name is heard, the whole carpool is
 * offered with every rider ticked, the visitor can untick anyone staying
 * behind, and one tap calls the rest. Pure, so the rules can be unit-tested;
 * `carpool-demo.tsx` only renders it and wires the taps.
 *
 * It follows the product's own rules on purpose: nothing reaches the board
 * until the tap, an unticked rider is left exactly as they were, and an
 * announcement that has been sent cannot be edited after the fact.
 */

/** What the curb phone heard: one rider's surname is enough. */
export const CARPOOL_HEARD = "Levy";
export const CARPOOL_NAME = "Levy carpool";

/**
 * The board. The carpool is two siblings and a neighbour who rides with them,
 * because a carpool is not always one family; the other three children show
 * that calling a carpool leaves everyone else alone.
 */
export const CARPOOL_BOARD: readonly DemoChild[] = [
  { id: "cp-noa", first_name: "Noa", last_name: "Levy", class_group: "2nd" },
  {
    id: "cp-anika",
    first_name: "Anika",
    last_name: "Patel",
    class_group: "1st",
  },
  {
    id: "cp-eitan",
    first_name: "Eitan",
    last_name: "Levy",
    class_group: "4th",
  },
  {
    id: "cp-mateo",
    first_name: "Mateo",
    last_name: "Garcia",
    class_group: "3rd",
  },
  { id: "cp-sam", first_name: "Sam", last_name: "Katz", class_group: "4th" },
  {
    id: "cp-chidi",
    first_name: "Chidi",
    last_name: "Okafor",
    class_group: "K2",
  },
];

export const CARPOOL_RIDER_IDS: readonly string[] = [
  "cp-noa",
  "cp-eitan",
  "cp-sam",
];

export interface CarpoolDemoState {
  /** Riders unticked for this announcement. */
  excludedIds: readonly string[];
  /** True once the visitor has tapped Announce. */
  announced: boolean;
}

export function initialCarpoolDemo(): CarpoolDemoState {
  return { excludedIds: [], announced: false };
}

/** The same thing by another name, so the "Start over" handler reads plainly. */
export function resetCarpoolDemo(): CarpoolDemoState {
  return initialCarpoolDemo();
}

export function isRiding(state: CarpoolDemoState, id: string): boolean {
  return CARPOOL_RIDER_IDS.includes(id) && !state.excludedIds.includes(id);
}

function ridingCount(state: CarpoolDemoState): number {
  return CARPOOL_RIDER_IDS.filter((id) => isRiding(state, id)).length;
}

export function toggleRider(
  state: CarpoolDemoState,
  id: string,
): CarpoolDemoState {
  if (state.announced || !CARPOOL_RIDER_IDS.includes(id)) return state;
  const excludedIds = state.excludedIds.includes(id)
    ? state.excludedIds.filter((excluded) => excluded !== id)
    : [...state.excludedIds, id];
  return { ...state, excludedIds };
}

export function announceCarpool(state: CarpoolDemoState): CarpoolDemoState {
  if (state.announced || ridingCount(state) === 0) return state;
  return { ...state, announced: true };
}

/** The Announce button's words: it always names exactly how many it will call. */
export function announceLabel(state: CarpoolDemoState): string {
  if (state.announced) return "Announced";
  const count = ridingCount(state);
  return count === 0 ? "Tick a rider" : `Announce ${count}`;
}

/** The demo board as the props the real board tile takes, in board order. */
export function carpoolTiles(state: CarpoolDemoState): DemoTile[] {
  return CARPOOL_BOARD.map((child) => {
    const arrived = state.announced && isRiding(state, child.id);
    return {
      flashing: arrived,
      student: {
        id: child.id,
        first_name: child.first_name,
        last_name: child.last_name,
        aliases: [],
        status: arrived ? "arrived" : "waiting",
        // Fixed, not `new Date()`: the tile never shows these, and a constant
        // keeps server and client renders identical.
        arrived_at: null,
        updated_at: "2026-01-01T00:00:00.000Z",
        carpool_id: null,
        class_groups: [child.class_group],
      },
    };
  });
}
