import { describe, expect, it } from "vitest";

import { ApiError } from "./api";
import {
  canMove,
  classifyDeleteFailure,
  deleteDecisionHeading,
  deleteResolution,
  moveButtonLabel,
  moveHelpLine,
  NO_TARGET_MOVE_LABEL,
  otherClasses,
  previewNames,
  removeWithoutMovingLine,
} from "./class-delete";

const decision = {
  memberCount: 14,
  soleMemberCount: 7,
  soleMembers: ["Ada", "Bo", "Cy", "Di", "Ed", "Flo", "Gus"].map((n, i) => ({
    id: `s${i}`,
    first_name: n,
    last_name: "Test",
  })),
};

describe("classifyDeleteFailure", () => {
  it("a 409 with the decision payload opens the dialog", () => {
    const error = new ApiError("conflict", 409, "Only here.", null, {
      memberCount: 14,
      soleMemberCount: 7,
      soleMembers: decision.soleMembers,
    });
    expect(classifyDeleteFailure(error)).toEqual({ kind: "decide", decision });
  });

  it("a 404 means the class is gone: refresh and show the sentence", () => {
    const error = new ApiError("request", 404, "That class no longer exists.");
    expect(classifyDeleteFailure(error)).toEqual({
      kind: "gone",
      message: "That class no longer exists.",
    });
  });

  it("any other ApiError just shows its sentence", () => {
    const error = new ApiError("pin", 401, "Wrong PIN.");
    expect(classifyDeleteFailure(error)).toEqual({
      kind: "failed",
      message: "Wrong PIN.",
    });
  });

  it("an unknown error gets a generic sentence", () => {
    expect(classifyDeleteFailure(new Error("boom"))).toEqual({
      kind: "failed",
      message: "Could not remove that class. Try again.",
    });
  });

  it("a 409 without a usable payload is treated as a plain failure", () => {
    const error = new ApiError("conflict", 409, "Conflict.");
    expect(classifyDeleteFailure(error).kind).toBe("failed");
  });
});

describe("canMove", () => {
  const targets = [
    { id: "k2", name: "K2", sortOrder: 1 },
    { id: "1st", name: "1st", sortOrder: 2 },
  ];

  it("is disabled until a class is chosen", () => {
    expect(canMove("", targets)).toBe(false);
    expect(canMove(null, targets)).toBe(false);
    expect(canMove("k2", targets)).toBe(true);
  });

  it("is false when the chosen class is no longer on offer", () => {
    expect(canMove("gone", targets)).toBe(false);
    expect(canMove("k2", [])).toBe(false);
  });
});

describe("deleteResolution", () => {
  it("Move re-sends moveToClassId", () => {
    expect(deleteResolution({ action: "move", moveToClassId: "k2" })).toEqual({
      moveToClassId: "k2",
    });
  });

  it("Remove without moving re-sends force", () => {
    expect(deleteResolution({ action: "force" })).toEqual({ force: true });
  });
});

describe("moveButtonLabel", () => {
  it("counts the whole membership, not just the sole members", () => {
    expect(moveButtonLabel(14, "3rd", "K1")).toBe(
      "Move all 14 to 3rd, then remove K1",
    );
  });
  it("does not say 'all' for a single student", () => {
    expect(moveButtonLabel(1, "3rd", "K1")).toBe(
      "Move 1 student to 3rd, then remove K1",
    );
  });
  it("tells the admin what to do while no destination is chosen", () => {
    expect(NO_TARGET_MOVE_LABEL).toBe("Choose a class to move them to");
  });
});

describe("moveHelpLine", () => {
  it("says everyone moves and extra classes are kept", () => {
    expect(moveHelpLine(14, "K1")).toBe(
      "All 14 students in K1 will move. Anyone also in another class keeps it.",
    );
  });
  it("handles a single student", () => {
    expect(moveHelpLine(1, "K1")).toBe(
      "The 1 student in K1 will move. Anyone also in another class keeps it.",
    );
  });
});

describe("removeWithoutMovingLine", () => {
  it("names the class and the stranded students", () => {
    expect(removeWithoutMovingLine("K1", 7)).toBe(
      "Or remove K1 and leave those 7 students with no class for now. They stay on the roster.",
    );
  });
  it("handles a single student", () => {
    expect(removeWithoutMovingLine("K1", 1)).toBe(
      "Or remove K1 and leave that student with no class for now. They stay on the roster.",
    );
  });
});

describe("deleteDecisionHeading", () => {
  it("pluralises", () => {
    expect(deleteDecisionHeading(7)).toBe(
      "7 students would be left with no class",
    );
    expect(deleteDecisionHeading(1)).toBe(
      "1 student would be left with no class",
    );
  });
});

describe("previewNames", () => {
  it("shows the first five names and how many more", () => {
    const preview = previewNames(decision.soleMembers, 7);
    expect(preview.names).toEqual([
      "Ada Test",
      "Bo Test",
      "Cy Test",
      "Di Test",
      "Ed Test",
    ]);
    expect(preview.more).toBe(2);
  });
  it("has no more when everyone is shown", () => {
    expect(previewNames(decision.soleMembers.slice(0, 2), 2).more).toBe(0);
  });
});

describe("otherClasses", () => {
  it("lists every class except the one being deleted", () => {
    const all = [
      { id: "a", name: "A", sortOrder: 1 },
      { id: "b", name: "B", sortOrder: 2 },
    ];
    expect(otherClasses(all, "a")).toEqual([all[1]]);
  });
});
