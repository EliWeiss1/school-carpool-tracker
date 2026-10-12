import { describe, expect, it } from "vitest";

import {
  type PadStudent,
  announceLabel,
  countStatuses,
  narrowedLabel,
  pruneSelection,
  railClasses,
  removeIds,
  scopeKey,
  selectedCountIn,
  selectedIds,
  studentsInClass,
  toggleSelected,
} from "./class-roster";

const s = (
  id: string,
  first: string,
  last: string,
  classGroup: string | null,
  status: PadStudent["status"] = "waiting",
): PadStudent => ({
  id,
  first_name: first,
  last_name: last,
  class_group: classGroup,
  status,
});

const ROSTER = [
  s("1", "Maya", "Cohen", "K1"),
  s("2", "Aaron", "Cohen", "K1", "arrived"),
  s("3", "Zoe", "Abrams", "K1"),
  s("4", "Eli", "Katz", "2nd"),
  s("5", "Nobody", "Classless", null),
];

describe("railClasses", () => {
  const all = ["K1", "K2", "1st", "2nd"];

  it("offers every class when nothing is narrowed", () => {
    expect(railClasses(all, [])).toEqual(all);
  });

  it("offers only the narrowed set, in the admin's order not click order", () => {
    expect(railClasses(all, ["2nd", "K1"])).toEqual(["K1", "2nd"]);
  });

  it("drops a narrowed name that is no longer a class", () => {
    expect(railClasses(all, ["K1", "Removed"])).toEqual(["K1"]);
  });
});

describe("studentsInClass", () => {
  it("returns one class, A to Z by surname then first name", () => {
    expect(studentsInClass(ROSTER, "K1").map((x) => x.id)).toEqual([
      "3",
      "2",
      "1",
    ]);
  });

  it("returns nothing for an empty or unknown class", () => {
    expect(studentsInClass(ROSTER, "5th")).toEqual([]);
  });

  it("does not mutate the roster it was given", () => {
    const before = ROSTER.map((x) => x.id);
    studentsInClass(ROSTER, "K1");
    expect(ROSTER.map((x) => x.id)).toEqual(before);
  });
});

describe("countStatuses", () => {
  it("splits waiting from arrived", () => {
    expect(countStatuses(studentsInClass(ROSTER, "K1"))).toEqual({
      waiting: 2,
      arrived: 1,
    });
  });
});

describe("selection", () => {
  it("adds, then removes, a pick", () => {
    const one = toggleSelected({}, "K1", "1");
    expect(one).toEqual({ K1: ["1"] });
    expect(toggleSelected(one, "K1", "1")).toEqual({});
  });

  it("never mutates the selection it was given", () => {
    const before = { K1: ["1"] };
    toggleSelected(before, "K1", "3");
    expect(before).toEqual({ K1: ["1"] });
  });

  it("flattens picks across classes and counts per class", () => {
    const sel = { K1: ["1", "3"], "2nd": ["4"] };
    expect(selectedIds(sel)).toEqual(["1", "3", "4"]);
    expect(selectedCountIn(sel, "K1")).toBe(2);
    expect(selectedCountIn(sel, "5th")).toBe(0);
  });

  it("prunes picks to the classes still offered", () => {
    expect(pruneSelection({ K1: ["1"], "2nd": ["4"] }, ["2nd"])).toEqual({
      "2nd": ["4"],
    });
  });

  it("removes announced ids and drops a class left empty", () => {
    expect(removeIds({ K1: ["1"], "2nd": ["4", "9"] }, ["1", "4"])).toEqual({
      "2nd": ["9"],
    });
  });
});

describe("announceLabel", () => {
  it("names a single student", () => {
    expect(announceLabel(ROSTER, ["1"])).toBe("Maya Cohen");
  });

  it("counts a batch rather than listing names that will not fit", () => {
    expect(announceLabel(ROSTER, ["1", "4"])).toBe("2 students");
    expect(announceLabel(ROSTER, ["1", "4", "3", "2"])).toBe("4 students");
  });

  it("falls back to a count when a lone id is not on the roster", () => {
    expect(announceLabel([], ["x"])).toBe("1 student");
  });
});

describe("scopeKey", () => {
  it("is the same whichever order the classes were picked in", () => {
    expect(scopeKey(["K1", "2nd"])).toBe(scopeKey(["2nd", "K1"]));
  });

  it("differs for different scopes, and the empty scope", () => {
    expect(scopeKey(["K1"])).not.toBe(scopeKey(["K1", "2nd"]));
    expect(scopeKey([])).not.toBe(scopeKey(["K1"]));
  });
});

describe("narrowedLabel", () => {
  it("reads plainly at each size", () => {
    expect(narrowedLabel([])).toBe("Narrow by class");
    expect(narrowedLabel(["K1", "2nd"])).toBe("Narrowed to K1, 2nd");
    expect(narrowedLabel(["K1", "K2", "1st", "2nd"])).toBe(
      "Narrowed to 4 classes",
    );
  });
});
