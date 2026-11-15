import { describe, expect, it, vi } from "vitest";

import { createTokenStore } from "./session-token";

const at = (seconds: number) => seconds * 1000;

describe("createTokenStore", () => {
  it("has no token until an event brings one", () => {
    const store = createTokenStore();
    expect(store.current()).toBeNull();
    store.apply("SIGNED_IN", { access_token: "a", expires_at: 9_999_999_999 });
    expect(store.current()).toBe("a");
  });

  it("can start from a known session", () => {
    const store = createTokenStore({
      initial: { access_token: "seed", expires_at: 9_999_999_999 },
    });
    expect(store.current()).toBe("seed");
  });

  it("returns null once the token has expired, by the injected clock", () => {
    let nowMs = at(1000);
    const store = createTokenStore({ now: () => nowMs });
    store.apply("INITIAL_SESSION", { access_token: "a", expires_at: 1100 });

    expect(store.current()).toBe("a");
    nowMs = at(1100);
    expect(store.current()).toBeNull();
  });

  it("replaces the token on refresh", () => {
    let nowMs = at(1000);
    const store = createTokenStore({ now: () => nowMs });
    store.apply("SIGNED_IN", { access_token: "old", expires_at: 1100 });
    nowMs = at(1099);
    store.apply("TOKEN_REFRESHED", { access_token: "new", expires_at: 2000 });
    nowMs = at(1200);
    expect(store.current()).toBe("new");
  });

  it("clears on sign out and on an initial event with no session", () => {
    const store = createTokenStore();
    store.apply("SIGNED_IN", { access_token: "a", expires_at: 9_999_999_999 });
    store.apply("SIGNED_OUT", null);
    expect(store.current()).toBeNull();

    store.apply("SIGNED_IN", { access_token: "a", expires_at: 9_999_999_999 });
    store.apply("INITIAL_SESSION", null);
    expect(store.current()).toBeNull();
  });

  it("ignores events that do not carry a login state", () => {
    const store = createTokenStore();
    store.apply("SIGNED_IN", { access_token: "a", expires_at: 9_999_999_999 });
    const listener = vi.fn();
    store.subscribe(listener);
    store.apply("USER_UPDATED", { access_token: "b", expires_at: 1 });
    expect(store.current()).toBe("a");
    expect(listener).not.toHaveBeenCalled();
  });

  it("treats a session with no expiry as valid and never near expiry", () => {
    const store = createTokenStore();
    store.apply("SIGNED_IN", { access_token: "a" });
    expect(store.current()).toBe("a");
    expect(store.expiresWithin(60_000)).toBe(false);
  });

  it("reports when the token is within the refresh window", () => {
    let nowMs = at(1000);
    const store = createTokenStore({ now: () => nowMs });
    store.apply("SIGNED_IN", { access_token: "a", expires_at: 1100 });

    expect(store.expiresWithin(60_000)).toBe(false);
    nowMs = at(1040);
    expect(store.expiresWithin(60_000)).toBe(true);
    nowMs = at(1200);
    expect(store.expiresWithin(60_000)).toBe(true);
  });

  it("is never near expiry with no token", () => {
    expect(createTokenStore().expiresWithin(60_000)).toBe(false);
  });

  it("notifies subscribers on change and stops after unsubscribe", () => {
    const store = createTokenStore();
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.apply("SIGNED_IN", { access_token: "a" });
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    store.apply("SIGNED_OUT", null);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
