import { describe, expect, it } from "vitest";

import { safeNext } from "./safe-redirect";

describe("safeNext", () => {
  it("keeps same-origin relative paths, with query and hash", () => {
    expect(safeNext("/welcome")).toBe("/welcome");
    expect(safeNext("/s/maple/admin?tab=1#x")).toBe("/s/maple/admin?tab=1#x");
  });

  it("falls back for absent or empty values", () => {
    expect(safeNext(null)).toBe("/app");
    expect(safeNext(undefined)).toBe("/app");
    expect(safeNext("")).toBe("/app");
  });

  it("uses the caller's fallback when given", () => {
    expect(safeNext("https://evil.test", "/welcome")).toBe("/welcome");
  });

  it("rejects anything that could leave the origin", () => {
    for (const bad of [
      "//evil.test",
      "///evil.test",
      "/\\evil.test",
      "\\evil.test",
      "https://evil.test",
      "javascript:alert(1)",
      "welcome",
      "/ok\\path",
      "/\t/evil.test",
      "/\n/evil.test",
      " /welcome",
    ]) {
      expect(safeNext(bad), bad).toBe("/app");
    }
  });

  it("takes the first value of a repeated query parameter", () => {
    expect(safeNext(["/welcome", "//evil.test"])).toBe("/welcome");
    expect(safeNext(["//evil.test"])).toBe("/app");
  });
});
