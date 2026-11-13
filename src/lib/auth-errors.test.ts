import { describe, expect, it } from "vitest";

import { authErrorMessage } from "./auth-errors";

describe("authErrorMessage", () => {
  it.each([
    [{ code: "invalid_credentials" }, /wrong email or password/i],
    [{ message: "Invalid login credentials" }, /wrong email or password/i],
    [{ code: "email_not_confirmed" }, /confirm your email/i],
    [{ message: "Email not confirmed" }, /confirm your email/i],
    [{ code: "user_already_exists" }, /already has an account/i],
    [{ message: "User already registered" }, /already has an account/i],
    [{ code: "over_request_rate_limit" }, /too many attempts/i],
    [{ code: "over_email_send_rate_limit" }, /too many attempts/i],
    [{ status: 429 }, /too many attempts/i],
    [{ code: "weak_password" }, /stronger password/i],
    [{ code: "captcha_failed" }, /could not confirm you are a person/i],
    [{ name: "AuthRetryableFetchError", status: 0 }, /could not connect/i],
    [{ message: "Failed to fetch" }, /could not connect/i],
  ])("maps %j", (input, expected) => {
    expect(authErrorMessage(input)).toMatch(expected);
  });

  it("gives a generic sentence for anything else, never the raw text", () => {
    const message = authErrorMessage({ message: "pg: relation foo missing" });
    expect(message).toMatch(/something went wrong/i);
    expect(message).not.toMatch(/pg:/);
  });

  it("copes with non-object input", () => {
    expect(authErrorMessage(null)).toMatch(/something went wrong/i);
    expect(authErrorMessage("boom")).toMatch(/something went wrong/i);
  });
});
