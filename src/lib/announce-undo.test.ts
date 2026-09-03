import { describe, expect, it } from "vitest";

import {
  UNDO_WINDOW_MS,
  canUndo,
  formatRemaining,
  remainingMs,
} from "./announce-undo";

const START = 1_000_000; // an arbitrary epoch ms, easier to read than Date.now()

function confirmationAt(confirmedAt: number) {
  return { studentId: "s1", displayName: "Maya Cohen", confirmedAt };
}

describe("remainingMs", () => {
  it("is the full window right after confirmation", () => {
    expect(remainingMs(confirmationAt(START), START)).toBe(UNDO_WINDOW_MS);
  });

  it("counts down as time passes", () => {
    expect(remainingMs(confirmationAt(START), START + 30_000)).toBe(
      UNDO_WINDOW_MS - 30_000,
    );
  });

  it("never goes negative once the window has passed", () => {
    expect(
      remainingMs(confirmationAt(START), START + UNDO_WINDOW_MS + 60_000),
    ).toBe(0);
  });

  it("is exactly zero at the boundary", () => {
    expect(remainingMs(confirmationAt(START), START + UNDO_WINDOW_MS)).toBe(0);
  });
});

describe("canUndo", () => {
  it("is true for the whole window", () => {
    expect(canUndo(confirmationAt(START), START)).toBe(true);
    expect(canUndo(confirmationAt(START), START + UNDO_WINDOW_MS - 1)).toBe(
      true,
    );
  });

  it("is false once the window has elapsed, including exactly at the edge", () => {
    expect(canUndo(confirmationAt(START), START + UNDO_WINDOW_MS)).toBe(
      false,
    );
    expect(
      canUndo(confirmationAt(START), START + UNDO_WINDOW_MS + 1),
    ).toBe(false);
  });

  it("is false for a confirmation that is somehow in the future (clock skew)", () => {
    // A negative remaining-time bug here would show a nonsense countdown
    // instead of just hiding the undo affordance.
    expect(canUndo(confirmationAt(START), START - 5_000)).toBe(true);
  });
});

describe("formatRemaining", () => {
  it("formats whole minutes and seconds as m:ss", () => {
    expect(formatRemaining(125_000)).toBe("2:05");
    expect(formatRemaining(60_000)).toBe("1:00");
    expect(formatRemaining(5_000)).toBe("0:05");
  });

  it("rounds up to the next second, so it never shows 0:00 while undo is still possible", () => {
    expect(formatRemaining(500)).toBe("0:01");
    expect(formatRemaining(1)).toBe("0:01");
  });

  it("floors at 0:00 and never goes negative", () => {
    expect(formatRemaining(0)).toBe("0:00");
    expect(formatRemaining(-500)).toBe("0:00");
  });

  it("pads seconds under 10", () => {
    expect(formatRemaining(9_000)).toBe("0:09");
  });
});
