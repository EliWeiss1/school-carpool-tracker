import { describe, expect, it } from "vitest";

import { normalizeHeading } from "./fields";

describe("normalizeHeading", () => {
  it.each([
    ["Student First Name", "first name"],
    ["child's_last_name", "last name"],
    ["FIRST-NAME:", "first name"],
    ["  Last   Name ", "last name"],
    ["Student", "student"],
    ["Mother’s Name", "mother name"],
  ])("%s -> %s", (raw, expected) => {
    expect(normalizeHeading(raw)).toBe(expected);
  });
});
