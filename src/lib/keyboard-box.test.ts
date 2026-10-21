import { describe, expect, it } from "vitest";

import { KEYBOARD_MIN_PX, keyboardBox } from "./keyboard-box";

describe("keyboardBox", () => {
  it("leaves the layout alone with no keyboard", () => {
    expect(keyboardBox({ height: 664, offsetTop: 0 }, 664)).toBeNull();
  });

  it("ignores a collapsing address bar", () => {
    expect(
      keyboardBox({ height: 664 - (KEYBOARD_MIN_PX - 1), offsetTop: 0 }, 664),
    ).toBeNull();
  });

  it("pins to the visible area above an iOS keyboard, panned or not", () => {
    expect(keyboardBox({ height: 370, offsetTop: 0 }, 664)).toEqual({
      top: 0,
      height: 370,
    });
    expect(keyboardBox({ height: 370.4, offsetTop: 294.2 }, 664)).toEqual({
      top: 294,
      height: 370,
    });
  });

  it("never sits above the page during iOS overscroll bounce", () => {
    expect(keyboardBox({ height: 370, offsetTop: -12 }, 664)?.top).toBe(0);
  });
});
