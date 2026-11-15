import { describe, expect, it } from "vitest";

import { voiceUsageSentence } from "./voice-usage";

describe("voiceUsageSentence", () => {
  it("says how much of a limit has been used", () => {
    expect(voiceUsageSentence({ used: 12, limit: 1000, enabled: true })).toBe(
      "12 of 1,000 voice sessions used this month.",
    );
  });

  it("uses the singular for one", () => {
    expect(voiceUsageSentence({ used: 1, limit: null, enabled: true })).toBe(
      "1 voice session this month. No monthly limit.",
    );
  });

  it("says there is no limit when there is none", () => {
    expect(voiceUsageSentence({ used: 240, limit: null, enabled: true })).toBe(
      "240 voice sessions this month. No monthly limit.",
    );
  });

  it("says what to do once the limit is reached", () => {
    expect(voiceUsageSentence({ used: 1000, limit: 1000, enabled: true })).toBe(
      "All 1,000 voice sessions for this month are used. Typing a name still works.",
    );
  });

  it("treats a count past the limit as reached, never as a negative remainder", () => {
    expect(voiceUsageSentence({ used: 1003, limit: 1000, enabled: true })).toBe(
      "All 1,000 voice sessions for this month are used. Typing a name still works.",
    );
  });

  it("says voice is off, whatever was used before", () => {
    expect(voiceUsageSentence({ used: 40, limit: 1000, enabled: false })).toBe(
      "Voice is turned off for this school. Typing a name still works.",
    );
  });
});
