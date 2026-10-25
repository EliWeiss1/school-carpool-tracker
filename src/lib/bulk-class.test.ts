import { describe, expect, it } from "vitest";

import {
  bulkConfirmText,
  bulkMembershipInput,
  bulkResultMessage,
} from "./bulk-class";

describe("bulkMembershipInput", () => {
  it("Add sends the selected ids as additions only", () => {
    expect(bulkMembershipInput("add", "k", new Set(["a", "b"]))).toEqual({
      classId: "k",
      addStudentIds: ["a", "b"],
    });
  });
  it("Remove sends them as removals only", () => {
    expect(bulkMembershipInput("remove", "k", new Set(["a"]))).toEqual({
      classId: "k",
      removeStudentIds: ["a"],
    });
  });
});

describe("bulkConfirmText", () => {
  it("Remove states the count and the class", () => {
    expect(bulkConfirmText("remove", 3, "Choir")).toBe(
      "Remove 3 students from Choir? They stay on the roster.",
    );
    expect(bulkConfirmText("remove", 1, "Choir")).toBe(
      "Remove 1 student from Choir? They stay on the roster.",
    );
  });
  it("Add states the count and the class", () => {
    expect(bulkConfirmText("add", 2, "Choir")).toBe("Add 2 students to Choir?");
  });
});

describe("bulkResultMessage", () => {
  it("reports the change and the class's new size", () => {
    expect(bulkResultMessage("add", 2, "Choir", 14, 0)).toBe(
      "2 students are now in Choir. It now has 14.",
    );
    expect(bulkResultMessage("remove", 1, "Choir", 9, 0)).toBe(
      "1 student is no longer in Choir. It now has 9.",
    );
  });
  it("does not claim to have added students who were already members", () => {
    // The server cannot tell us how many were new, so the sentence states the
    // end state ("are now in") rather than a count of additions.
    expect(bulkResultMessage("add", 1, "Choir", 14, 0)).toBe(
      "1 student is now in Choir. It now has 14.",
    );
    expect(bulkResultMessage("add", 2, "Choir", 14, 0)).not.toMatch(/Added/);
  });
  it("mentions students who were already gone", () => {
    expect(bulkResultMessage("add", 3, "Choir", 5, 1)).toBe(
      "3 students are now in Choir. It now has 5. 1 was already gone.",
    );
    expect(bulkResultMessage("add", 3, "Choir", 5, 2)).toContain(
      "2 were already gone",
    );
  });
});

describe("bulkConfirmText with stranded students", () => {
  it("adds how many will have no class after a Remove", () => {
    expect(bulkConfirmText("remove", 3, "Choir", 2)).toBe(
      "Remove 3 students from Choir? They stay on the roster. 2 of them will have no class after this.",
    );
  });
  it("words the single-student case without 'of them'", () => {
    expect(bulkConfirmText("remove", 1, "Choir", 1)).toBe(
      "Remove 1 student from Choir? They stay on the roster. That student will have no class after this.",
    );
  });
  it("says nothing extra when nobody is stranded, and never for Add", () => {
    expect(bulkConfirmText("remove", 3, "Choir", 0)).toBe(
      "Remove 3 students from Choir? They stay on the roster.",
    );
    expect(bulkConfirmText("add", 3, "Choir", 2)).toBe(
      "Add 3 students to Choir?",
    );
  });
});
