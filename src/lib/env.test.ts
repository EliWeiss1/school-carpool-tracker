import { afterEach, describe, expect, it } from "vitest";
import { functionsBaseUrl, publicEnv } from "@/lib/env";

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
});

describe("publicEnv", () => {
  it("throws a fixable message when a variable is missing", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(() => publicEnv.supabaseUrl).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("treats mockSpeech as opt-in", () => {
    delete process.env.NEXT_PUBLIC_MOCK_SPEECH;
    expect(publicEnv.mockSpeech).toBe(false);
    process.env.NEXT_PUBLIC_MOCK_SPEECH = "true";
    expect(publicEnv.mockSpeech).toBe(true);
  });
});

describe("functionsBaseUrl", () => {
  it("derives the functions host from the project URL", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://demo.supabase.co/";
    expect(functionsBaseUrl()).toBe("https://demo.supabase.co/functions/v1");
  });

  it("prefers an explicit override, e.g. the local CLI", () => {
    process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL =
      "http://127.0.0.1:54321/functions/v1/";
    expect(functionsBaseUrl()).toBe("http://127.0.0.1:54321/functions/v1");
  });
});
