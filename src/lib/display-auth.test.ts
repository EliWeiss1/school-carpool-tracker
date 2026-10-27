import { describe, expect, it } from "vitest";

import {
  accessToken,
  cookieIsValid,
  passwordIsCorrect,
  safeEqual,
} from "./display-auth";

describe("display auth", () => {
  it("accepts only the exact password", async () => {
    expect(await passwordIsCorrect("test-pass", "test-pass")).toBe(true);
    expect(await passwordIsCorrect("test-pasz", "test-pass")).toBe(false);
    expect(await passwordIsCorrect("", "test-pass")).toBe(false);
  });

  it("never puts the password in the cookie value", async () => {
    expect(await accessToken("test-pass")).not.toContain("test-pass");
  });

  it("validates the cookie against the current password", async () => {
    const token = await accessToken("test-pass");
    expect(await cookieIsValid(token, "test-pass")).toBe(true);
    expect(await cookieIsValid(token, "changed")).toBe(false);
    expect(await cookieIsValid(undefined, "test-pass")).toBe(false);
  });

  it("fails closed when no password is configured", async () => {
    expect(await cookieIsValid(await accessToken(""), null)).toBe(false);
  });

  it("safeEqual rejects different lengths", () => {
    expect(safeEqual("a", "ab")).toBe(false);
  });
});
