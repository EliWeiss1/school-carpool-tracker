import { describe, expect, it } from "vitest";

import { ApiError } from "./api";
import {
  isSignedOutError,
  messageFrom,
  schoolAuthFrom,
} from "./school-session-auth";

describe("schoolAuthFrom", () => {
  it("is null with no credentials", () => {
    expect(schoolAuthFrom(null)).toBeNull();
  });
  it("is null for a PIN, which is not an account", () => {
    expect(schoolAuthFrom({ pin: "1234", deviceId: "d" })).toBeNull();
  });
  it("passes a session through", () => {
    expect(
      schoolAuthFrom({ schoolId: "s", accessToken: "t", deviceId: "d" }),
    ).toEqual({ schoolId: "s", accessToken: "t", deviceId: "d" });
  });
});

describe("error helpers", () => {
  it("uses the server sentence verbatim", () => {
    expect(messageFrom(new ApiError("request", 400, "Use 6 to 20."), "x")).toBe(
      "Use 6 to 20.",
    );
    expect(messageFrom(new Error("boom"), "Try again.")).toBe("Try again.");
  });
  it("spots a rejected sign-in", () => {
    expect(isSignedOutError(new ApiError("pin", 401, "no"))).toBe(true);
    expect(isSignedOutError(new ApiError("request", 400, "no"))).toBe(false);
    expect(isSignedOutError(new Error("no"))).toBe(false);
  });
});
