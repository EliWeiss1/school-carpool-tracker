import { describe, expect, it } from "vitest";

import {
  type PadStudent,
  addSelected,
  announceLabel,
  carpoolMembers,
  promptPicks,
  tapAction,
  countStatuses,
  classFilterLabel,
  pruneSelection,
  railClasses,
  railLabels,
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
  carpoolId: string | null = null,
): PadStudent => ({
  id,
  first_name: first,
  last_name: last,
  class_group: classGroup,
  status,
  carpool_id: carpoolId,
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

describe("classFilterLabel", () => {
  it("stays short enough for the header at each size", () => {
    expect(classFilterLabel([])).toBe("All classes");
    expect(classFilterLabel(["K1"])).toBe("K1");
    expect(classFilterLabel(["K1", "K2", "1st", "2nd"])).toBe("4 classes");
  });
});

describe("railLabels", () => {
  it("keeps short names whole", () => {
    const labels = railLabels(["K1", "1st", "2nd"]);
    expect(labels.get("K1")).toEqual({ top: "K1" });
    expect(labels.get("2nd")).toEqual({ top: "2nd" });
  });

  it("keeps a short prefix and abbreviates the rest", () => {
    const labels = railLabels([
      "EC Hummingbirds",
      "EC Chipmunks",
      "K2 Shoshanim",
    ]);
    expect(labels.get("EC Hummingbirds")).toEqual({ top: "EC", bottom: "HUM" });
    expect(labels.get("EC Chipmunks")).toEqual({ top: "EC", bottom: "CHI" });
    expect(labels.get("K2 Shoshanim")).toEqual({ top: "K2", bottom: "SHO" });
  });

  it("abbreviates a long single word onto one line", () => {
    expect(railLabels(["Kindergarten"]).get("Kindergarten")).toEqual({
      top: "KIN",
    });
  });

  it("widens only the labels that would otherwise collide", () => {
    const labels = railLabels(["EC Robins", "EC Robots", "EC Eagles"]);
    expect(labels.get("EC Robins")).toEqual({ top: "EC", bottom: "ROBI" });
    expect(labels.get("EC Robots")).toEqual({ top: "EC", bottom: "ROBO" });
    expect(labels.get("EC Eagles")).toEqual({ top: "EC", bottom: "EAG" });
  });

  it("labels every class even when names stay identical to the cap", () => {
    const labels = railLabels(["EC Butterflies A", "EC Butterflies B"]);
    expect(labels.size).toBe(2);
  });
});

describe("addSelected", () => {
  it("adds picks across classes and skips anyone already picked", () => {
    const next = addSelected({ K1: ["1"] }, [
      { classGroup: "K1", studentId: "1" },
      { classGroup: "K1", studentId: "3" },
      { classGroup: "2nd", studentId: "4" },
    ]);

    expect(next).toEqual({ K1: ["1", "3"], "2nd": ["4"] });
  });

  it("returns the selection untouched for no picks", () => {
    const before = { K1: ["1"] };
    expect(addSelected(before, [])).toBe(before);
  });
});

describe("carpools", () => {
  // Weiss siblings in three classes, one of whom has already arrived, plus a
  // lone Katz in a carpool of one, and a student with no carpool at all.
  const FAMILY = [
    s("w1", "Dan", "Weiss", "K1", "waiting", "weiss"),
    s("w2", "Ava", "Weiss", "3rd", "waiting", "weiss"),
    s("w3", "Sam", "Weiss", "5th", "arrived", "weiss"),
    s("k1", "Eli", "Katz", "2nd", "waiting", "katz"),
    s("solo", "Noa", "Alone", "2nd"),
  ];

  describe("carpoolMembers", () => {
    it("finds waiting mates across classes, A to Z, leaving out anyone already here", () => {
      expect(carpoolMembers(FAMILY, FAMILY[0]).map((x) => x.id)).toEqual([
        "w2",
        "w1",
      ]);
    });

    it("is just the student when they have no carpool", () => {
      expect(carpoolMembers(FAMILY, FAMILY[4]).map((x) => x.id)).toEqual([
        "solo",
      ]);
    });

    it("is just the student when every mate has already arrived", () => {
      const lone = [
        s("a", "A", "Lone", "K1", "waiting", "c"),
        s("b", "B", "Lone", "K1", "arrived", "c"),
      ];
      expect(carpoolMembers(lone, lone[0])).toHaveLength(1);
    });
  });

  describe("tapAction", () => {
    it("sends an arrived student back", () => {
      expect(tapAction(FAMILY, {}, FAMILY[2])).toBe("unannounce");
    });

    it("un-picks a picked student without asking again", () => {
      expect(tapAction(FAMILY, { K1: ["w1"] }, FAMILY[0])).toBe("deselect");
    });

    it("asks who is riding when waiting carpool-mates exist", () => {
      expect(tapAction(FAMILY, {}, FAMILY[0])).toBe("prompt");
    });

    it("just picks someone with no waiting carpool-mates", () => {
      expect(tapAction(FAMILY, {}, FAMILY[3])).toBe("select");
      expect(tapAction(FAMILY, {}, FAMILY[4])).toBe("select");
    });
  });

  describe("promptPicks", () => {
    const members = [FAMILY[1], FAMILY[0]];

    it("takes everyone by default, filed under their own class", () => {
      expect(promptPicks(members, [])).toEqual([
        { classGroup: "3rd", studentId: "w2" },
        { classGroup: "K1", studentId: "w1" },
      ]);
    });

    it("leaves out whoever was un-ticked", () => {
      expect(promptPicks(members, ["w2"])).toEqual([
        { classGroup: "K1", studentId: "w1" },
      ]);
    });

    it("is empty when everyone is un-ticked", () => {
      expect(promptPicks(members, ["w1", "w2"])).toEqual([]);
    });
  });
});
