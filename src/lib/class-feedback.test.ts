import { describe, expect, it } from "vitest";

import {
  addedMessage,
  memberCountAfter,
  removedMessage,
  savedMessage,
} from "./class-feedback";

describe("memberCountAfter", () => {
  it("adds the additions and subtracts the removals", () => {
    expect(memberCountAfter(10, { add: ["a", "b"], remove: ["c"] })).toBe(11);
  });
  it("never goes below zero", () => {
    expect(memberCountAfter(0, { add: [], remove: ["c"] })).toBe(0);
  });
});

describe("savedMessage", () => {
  it("states the class and its new size", () => {
    expect(savedMessage("3rd", 14)).toBe("Saved. 3rd now has 14 students.");
  });
  it("uses the singular for one student", () => {
    expect(savedMessage("3rd", 1)).toBe("Saved. 3rd now has 1 student.");
  });
});

describe("addedMessage", () => {
  it("says where the new class landed", () => {
    expect(addedMessage("Choir")).toBe(
      "Added Choir at the bottom of the list.",
    );
  });
});

describe("removedMessage", () => {
  it("says only that the class went when nobody moved", () => {
    expect(removedMessage("Choir")).toBe("Removed Choir.");
  });
  it("says who moved where", () => {
    expect(removedMessage("Choir", { count: 12, targetName: "3rd" })).toBe(
      "Removed Choir. 12 students moved to 3rd.",
    );
    expect(removedMessage("Choir", { count: 1, targetName: "3rd" })).toBe(
      "Removed Choir. 1 student moved to 3rd.",
    );
  });
  it("treats a move of nobody as a plain remove", () => {
    expect(removedMessage("Choir", { count: 0, targetName: "3rd" })).toBe(
      "Removed Choir.",
    );
  });
});
