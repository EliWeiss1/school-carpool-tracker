import { describe, expect, it } from "vitest";

import { checklistComplete, deriveChecklist } from "./school-checklist";

const empty = {
  classes: 0,
  students: 0,
  announceCodeSet: false,
  displayCodeSet: false,
  devices: 0,
};

describe("deriveChecklist", () => {
  it("lists four steps in order, none done for a new school", () => {
    const items = deriveChecklist(empty);
    expect(items.map((i) => i.id)).toEqual([
      "classes",
      "students",
      "code",
      "device",
    ]);
    expect(items.every((i) => !i.done)).toBe(true);
    expect(checklistComplete(items)).toBe(false);
  });
  it("marks each step from its own count", () => {
    const items = deriveChecklist({
      ...empty,
      classes: 2,
      displayCodeSet: true,
    });
    expect(items.map((i) => i.done)).toEqual([true, false, true, false]);
  });
  it("either code completes the code step", () => {
    expect(deriveChecklist({ ...empty, announceCodeSet: true })[2].done).toBe(
      true,
    );
  });
  it("is complete when all four are done", () => {
    const items = deriveChecklist({
      classes: 1,
      students: 1,
      announceCodeSet: true,
      displayCodeSet: false,
      devices: 1,
    });
    expect(checklistComplete(items)).toBe(true);
  });
});
