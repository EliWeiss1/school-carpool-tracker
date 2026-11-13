import { describe, expect, it } from "vitest";

import {
  MIN_PASSWORD_LENGTH,
  validateEmail,
  validateLogin,
  validatePassword,
  validateSignUp,
} from "./auth-fields";

describe("validateEmail", () => {
  it("accepts ordinary addresses, trimmed", () => {
    expect(validateEmail("  office@maple.school ")).toBeNull();
    expect(validateEmail("a.b+c@sub.example.org")).toBeNull();
  });

  it("rejects empty and malformed addresses with a sentence", () => {
    expect(validateEmail("")).toMatch(/enter your email/i);
    for (const bad of [
      "office",
      "office@",
      "@maple.school",
      "a@b",
      "a b@c.d",
    ]) {
      expect(validateEmail(bad), bad).toMatch(/email address/i);
    }
  });
});

describe("validatePassword", () => {
  it("requires at least 8 characters", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
    expect(validatePassword("1234567")).toMatch(/at least 8/i);
    expect(validatePassword("12345678")).toBeNull();
  });

  it("does not trim: spaces are legitimate password characters", () => {
    expect(validatePassword("       a")).toBeNull();
  });

  it("asks for a password when empty", () => {
    expect(validatePassword("")).toMatch(/enter a password/i);
  });
});

describe("validateSignUp", () => {
  it("reports every failing field at once", () => {
    const result = validateSignUp({
      schoolName: " ",
      email: "x",
      password: "y",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual([
        "email",
        "password",
        "schoolName",
      ]);
    }
  });

  it("returns trimmed values when valid", () => {
    const result = validateSignUp({
      schoolName: "  Maple Grove ",
      email: " Office@Maple.school ",
      password: "correct horse",
    });
    expect(result).toEqual({
      ok: true,
      values: {
        schoolName: "Maple Grove",
        email: "Office@Maple.school",
        password: "correct horse",
      },
    });
  });
});

describe("validateLogin", () => {
  it("does not enforce the length rule on sign in", () => {
    // An account made before a rule change must still be able to get in.
    expect(validateLogin({ email: "a@b.co", password: "short" }).ok).toBe(true);
  });

  it("still needs both fields", () => {
    expect(validateLogin({ email: "", password: "" }).ok).toBe(false);
  });
});
