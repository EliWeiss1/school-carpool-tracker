import { describe, expect, it } from "vitest";

import { ApiError } from "./api";
import {
  canMove,
  classifyDeleteFailure,
  deleteDecisionHeading,
  deleteResolution,
  moveButtonLabel,
  otherClasses,
  previewNames,
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

  it("Delete anyway re-sends force", () => {
    expect(deleteResolution({ action: "force" })).toEqual({ force: true });
  });
});

describe("moveButtonLabel", () => {
  it("counts the whole membership, not just the sole members", () => {
    expect(moveButtonLabel(14, "3rd")).toBe(
      "Move 14 students to 3rd and delete",
    );
  });
  it("uses the singular for one student", () => {
    expect(moveButtonLabel(1, "3rd")).toBe("Move 1 student to 3rd and delete");
  });
});

describe("deleteDecisionHeading", () => {
  it("pluralises", () => {
    expect(deleteDecisionHeading(7)).toBe("7 students are only in this class");
    expect(deleteDecisionHeading(1)).toBe("1 student is only in this class");
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
