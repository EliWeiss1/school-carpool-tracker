/**
 * Where a full-height screen should sit while an on-screen keyboard is open.
 *
 * iOS Safari never shrinks the layout for the keyboard (it ignores the
 * `interactive-widget` viewport setting Android honours): the keyboard
 * covers the bottom of the page and Safari pans the page up to reveal the
 * focused input, which on /announce scrolls the header and the top of the
 * suggestions out of sight. The visual viewport is the part still showing;
 * pinning the screen to it keeps the header at the top and the dock on the
 * keyboard.
 *
 * Pure so it can be tested without a browser; `use-keyboard-box.ts` is the
 * React side.
 */

/** The fields of `window.visualViewport` this needs. */
export interface VisualViewportLike {
  height: number;
  offsetTop: number;
}

export interface KeyboardBox {
  /** Pixels from the top of the layout viewport to the visible area. */
  top: number;
  /** Height of the visible area. */
  height: number;
}

/**
 * Below this, a shorter visual viewport is browser chrome (a collapsing
 * address bar is ~50-80px) or pinch-zoom noise, not a keyboard -- and the
 * layout is already right for those.
 */
export const KEYBOARD_MIN_PX = 120;

/**
 * The box the screen should occupy, or null when it should simply fill the
 * layout viewport -- no keyboard, or a browser (Android with
 * `interactive-widget=resizes-content`) that already shrank the layout.
 */
export function keyboardBox(
  viewport: VisualViewportLike,
  layoutHeight: number,
): KeyboardBox | null {
  if (layoutHeight - viewport.height < KEYBOARD_MIN_PX) return null;
  return {
    top: Math.max(0, Math.round(viewport.offsetTop)),
    height: Math.round(viewport.height),
  };
}
