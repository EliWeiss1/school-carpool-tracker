import type { StudentWithClasses } from "@/types/db";

/**
 * The script behind the landing page's hero: a name is heard at the curb, a
 * person confirms it, and that child's tile turns on the board. Pure and
 * timer-free so the loop can be unit-tested; `pickup-demo.tsx` only schedules
 * `advanceDemo` and renders the result with the real board tile.
 *
 * It mirrors the product's own rule on purpose. A visitor watching the loop
 * should never see a tile change without the confirm step before it, because
 * the product never does that either.
 */

export interface DemoChild {
  id: string;
  first_name: string;
  last_name: string;
  class_group: string;
}

/** Invented names, short enough to sit comfortably in a small tile. */
export const DEMO_CHILDREN: readonly DemoChild[] = [
  {
    id: "demo-cohen",
    first_name: "Maya",
    last_name: "Cohen",
    class_group: "K2",
  },
  {
    id: "demo-patel",
    first_name: "Anika",
    last_name: "Patel",
    class_group: "1st",
  },
  {
    id: "demo-garcia",
    first_name: "Mateo",
    last_name: "Garcia",
    class_group: "3rd",
  },
  {
    id: "demo-nguyen",
    first_name: "Layla",
    last_name: "Nguyen",
    class_group: "2nd",
  },
  {
    id: "demo-okafor",
    first_name: "Chidi",
    last_name: "Okafor",
    class_group: "4th",
  },
  {
    id: "demo-berg",
    first_name: "Noah",
    last_name: "Berg",
    class_group: "5th",
  },
];

/**
 * Who gets called, in order. Deliberately not everyone: a board where some
 * children are still waiting is the honest picture of a pickup line, and it
 * keeps both tile colours on screen at every step.
 */
export const DEMO_CALL_ORDER: readonly string[] = [
  "demo-cohen",
  "demo-garcia",
  "demo-okafor",
  "demo-patel",
];

/**
 * `listening`: the curb phone is waiting for a name.
 * `heard`: it shows what it heard and offers the match; nothing has changed.
 * `confirmed`: the person tapped, and the tile flips and flashes.
 */
export type DemoPhase = "listening" | "heard" | "confirmed";

export interface DemoState {
  phase: DemoPhase;
  /** Position in DEMO_CALL_ORDER of the child being called right now. */
  callIndex: number;
  arrivedIds: readonly string[];
  /** The most recent arrival, held gold the way /display holds it. */
  flashingId: string | null;
}

export function initialDemoState(): DemoState {
  return { phase: "listening", callIndex: 0, arrivedIds: [], flashingId: null };
}

/** The child the curb phone is asking about in this state. */
export function childBeingCalled(state: DemoState): DemoChild {
  const id = DEMO_CALL_ORDER[state.callIndex];
  const child = DEMO_CHILDREN.find((candidate) => candidate.id === id);
  // Unreachable while DEMO_CALL_ORDER only names demo children, which the
  // tests assert; failing loudly beats rendering an empty name.
  if (!child) throw new Error(`Demo script names an unknown child: ${id}`);
  return child;
}

/** One step of the loop. After the last scripted arrival it starts over. */
export function advanceDemo(state: DemoState): DemoState {
  switch (state.phase) {
    case "listening":
      return { ...state, phase: "heard" };
    case "heard": {
      const id = childBeingCalled(state).id;
      return {
        ...state,
        phase: "confirmed",
        arrivedIds: [...state.arrivedIds, id],
        flashingId: id,
      };
    }
    case "confirmed": {
      const next = state.callIndex + 1;
      if (next >= DEMO_CALL_ORDER.length) return initialDemoState();
      return { ...state, phase: "listening", callIndex: next };
    }
  }
}

const STEP_DELAY_MS: Record<DemoPhase, number> = {
  listening: 1400,
  heard: 1700,
  // Longest, so the flash and the gold hold have time to be noticed.
  confirmed: 2800,
};

/** How long the loop rests in a phase before the next step. */
export function demoStepDelayMs(phase: DemoPhase): number {
  return STEP_DELAY_MS[phase];
}

/**
 * The single frame shown instead of the loop under `prefers-reduced-motion`:
 * two children already called, a third offered for confirmation, nothing
 * flashing. It still tells the whole story without moving.
 */
export function stillDemoState(): DemoState {
  return {
    phase: "heard",
    callIndex: 2,
    arrivedIds: DEMO_CALL_ORDER.slice(0, 2),
    flashingId: null,
  };
}

export interface DemoTile {
  student: StudentWithClasses;
  flashing: boolean;
}

/** The demo roster as the props the real board tile takes, in roster order. */
export function demoTiles(state: DemoState): DemoTile[] {
  return DEMO_CHILDREN.map((child) => {
    const arrived = state.arrivedIds.includes(child.id);
    return {
      flashing: state.flashingId === child.id,
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
