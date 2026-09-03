import { describe, expect, it } from "vitest";

import { REFRESH_BUFFER_MS, expiresAt, isFresh } from "./announce-token";

describe("expiresAt", () => {
  it("adds the seconds the server granted, in ms", () => {
    expect(expiresAt(1_000, 30)).toBe(1_000 + 30_000);
  });

  it("treats a non-finite or non-positive TTL as already expired", () => {
    expect(expiresAt(1_000, 0)).toBe(1_000);
    expect(expiresAt(1_000, -5)).toBe(1_000);
    expect(expiresAt(1_000, Number.NaN)).toBe(1_000);
  });
});

describe("isFresh", () => {
  it("is fresh well before expiry", () => {
    const at = expiresAt(0, 300);
    expect(isFresh(at, 0)).toBe(true);
  });

  it("treats the token as stale inside the refresh buffer, before the hard deadline", () => {
    const at = expiresAt(0, 300);
    expect(isFresh(at, at - REFRESH_BUFFER_MS - 1)).toBe(true);
    expect(isFresh(at, at - REFRESH_BUFFER_MS + 1)).toBe(false);
  });

  it("is stale once the deadline has passed", () => {
    const at = expiresAt(0, 300);
    expect(isFresh(at, at)).toBe(false);
    expect(isFresh(at, at + 1)).toBe(false);
  });

  it("is never fresh for a null token state", () => {
    expect(isFresh(null, 0)).toBe(false);
  });
});
