import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api";
import {
  requireCredentials,
  signedOutMessage,
} from "@/lib/require-credentials";

const school = { id: "s1", name: "Oak", slug: "oak" };
const session = (creds: { pin: string; deviceId: string } | null) => ({
  credentials: () => creds,
});

describe("signedOutMessage", () => {
  it("keeps the PIN wording on the legacy routes", () => {
    expect(signedOutMessage(null)).toBe(
      "The staff session timed out. Enter the PIN again.",
    );
  });

  it("does not mention a PIN on a school route", () => {
    expect(signedOutMessage(school)).toBe(
      "You are no longer signed in. Sign in or enter the school's code again.",
    );
  });
});

describe("requireCredentials", () => {
  it("returns the credentials when there are some", () => {
    const creds = { pin: "1", deviceId: "d" };
    expect(requireCredentials(session(creds), null)).toBe(creds);
  });

  it("throws a 401 ApiError with the scoped message when there are none", () => {
    try {
      requireCredentials(session(null), school);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(401);
      expect((error as ApiError).message).toBe(signedOutMessage(school));
    }
  });
});
