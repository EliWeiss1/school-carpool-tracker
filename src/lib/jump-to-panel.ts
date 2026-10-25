/**
 * Jump to a panel further down /admin (the Classes panel sits below a roster
 * of a couple of hundred rows). Scrolling alone is not enough for keyboard and
 * screen-reader users, so focus moves to the panel's heading as well.
 */

/** Smooth scrolling is motion; honour `prefers-reduced-motion` with a plain jump. */
export function scrollBehaviorFor(
  prefersReducedMotion: boolean,
): ScrollBehavior {
  return prefersReducedMotion ? "auto" : "smooth";
}

/**
 * Scrolls the element with `panelId` into view and focuses its
 * `[data-panel-heading]` (which must carry `tabIndex={-1}`). No-op if the
 * panel is not on the page.
 */
export function jumpToPanel(panelId: string): void {
  const panel = document.getElementById(panelId);
  if (panel === null) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  panel.scrollIntoView({
    behavior: scrollBehaviorFor(reduced),
    block: "start",
  });
  panel
    .querySelector<HTMLElement>("[data-panel-heading]")
    ?.focus({ preventScroll: true });
}
