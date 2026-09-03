import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPinSession } from "./pin-session";

describe("pin session", () => {
  let session: ReturnType<typeof createPinSession>;

  beforeEach(() => {
    session = createPinSession();
  });

  it("starts locked", () => {
    expect(session.getSnapshot().unlocked).toBe(false);
    expect(session.requirePin()).toBeNull();
  });

  it("unlocks with a PIN and hands it back to callers that need it", () => {
    session.unlock("123456");

    expect(session.getSnapshot().unlocked).toBe(true);
    expect(session.requirePin()).toBe("123456");
  });

  it("trims surrounding whitespace from a typed PIN", () => {
    session.unlock("  123456 ");

    expect(session.requirePin()).toBe("123456");
  });

  it("refuses to unlock with an empty PIN", () => {
    expect(() => session.unlock("   ")).toThrow(/PIN/i);
    expect(session.getSnapshot().unlocked).toBe(false);
  });

  it("locks again on demand, forgetting the PIN", () => {
    session.unlock("123456");
    session.lock();

    expect(session.getSnapshot().unlocked).toBe(false);
    expect(session.requirePin()).toBeNull();
  });

  it("notifies subscribers on unlock and on lock, but not on a no-op lock", () => {
    const listener = vi.fn();
    session.subscribe(listener);

    session.unlock("123456");
    session.lock();
    session.lock();

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);

    unsubscribe();
    session.unlock("123456");

    expect(listener).not.toHaveBeenCalled();
  });

  it("returns a stable snapshot object so React does not loop", () => {
    const first = session.getSnapshot();

    expect(session.getSnapshot()).toBe(first);

    session.unlock("123456");
    const second = session.getSnapshot();

    expect(second).not.toBe(first);
    expect(session.getSnapshot()).toBe(second);
  });

  it("never exposes the PIN through the snapshot React renders", () => {
    session.unlock("123456");

    expect(JSON.stringify(session.getSnapshot())).not.toContain("123456");
  });

  it("reports locked on the server so the PIN gate renders on first paint", () => {
    session.unlock("123456");

    expect(session.getServerSnapshot().unlocked).toBe(false);
  });

  it("writes nothing to any browser storage", () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { setItem, getItem: () => null });
    vi.stubGlobal("sessionStorage", { setItem, getItem: () => null });
    vi.stubGlobal("document", { cookie: "" });

    createPinSession().unlock("123456");

    expect(setItem).not.toHaveBeenCalled();
    expect(
      (globalThis as { document: { cookie: string } }).document.cookie,
    ).toBe("");

    vi.unstubAllGlobals();
  });
});
