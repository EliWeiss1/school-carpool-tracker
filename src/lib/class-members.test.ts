import { describe, expect, it } from "vitest";

import type { RosterStudent } from "./admin-api";
import {
  describeDiff,
  diffMembership,
  filterStudents,
  canOpenMembersSheet,
  classPickOf,
  countLeftWithNoClass,
  hasChanges,
  memberCountLabel,
  memberIdsOf,
  membersPayload,
  scopeForClassPick,
  studentClassesLine,
} from "./class-members";

function student(
  id: string,
  first: string,
  last: string,
  classes: string[],
  aliases: string[] = [],
): RosterStudent {
  return {
    id,
    first_name: first,
    last_name: last,
    aliases,
    status: "waiting",
    arrived_at: null,
    updated_at: "2026-01-01T00:00:00Z",
    carpool_id: null,
    class_groups: classes,
    parent1_name: null,
    parent2_name: null,
  };
}

const ROSTER = [
  student("a", "Miriam", "Cohen", ["3rd"], ["Mimi"]),
  student("b", "Aaron", "Cohen", ["3rd", "Choir"]),
  student("c", "Rivka", "Levi", ["Choir"]),
  student("d", "Noam", "Katz", []),
];

const base = { text: "", classId: "choir-id", className: "Choir" } as const;

describe("diffMembership", () => {
  it("returns only the changes", () => {
    const diff = diffMembership(new Set(["a", "b"]), new Set(["b", "c", "d"]));
    expect(diff.add.sort()).toEqual(["c", "d"]);
    expect(diff.remove).toEqual(["a"]);
  });

  it("is empty when unchanged", () => {
    expect(diffMembership(new Set(["a", "b"]), new Set(["b", "a"]))).toEqual({
      add: [],
      remove: [],
    });
  });
});

describe("hasChanges", () => {
  it("is false until something is added or removed (Save stays disabled)", () => {
    expect(hasChanges({ add: [], remove: [] })).toBe(false);
    expect(hasChanges({ add: ["x"], remove: [] })).toBe(true);
    expect(hasChanges({ add: [], remove: ["x"] })).toBe(true);
  });
});

describe("memberIdsOf", () => {
  it("collects the students whose classes include the named class", () => {
    expect([...memberIdsOf(ROSTER, "Choir")].sort()).toEqual(["b", "c"]);
  });
});

describe("filterStudents", () => {
  it('scope "all" returns everyone', () => {
    expect(filterStudents(ROSTER, { ...base, scope: "all" })).toHaveLength(4);
  });

  it('scope "in" keeps only members of the class', () => {
    const ids = filterStudents(ROSTER, { ...base, scope: "in" }).map(
      (s) => s.id,
    );
    expect(ids).toEqual(["b", "c"]);
  });

  it('scope "out" keeps only non-members', () => {
    const ids = filterStudents(ROSTER, { ...base, scope: "out" }).map(
      (s) => s.id,
    );
    expect(ids).toEqual(["a", "d"]);
  });

  it("an other-class scope keeps students in that class, members or not", () => {
    const ids = filterStudents(ROSTER, {
      ...base,
      scope: { classGroup: "3rd" },
    }).map((s) => s.id);
    expect(ids).toEqual(["a", "b"]);
  });

  it("matches first name, last name and aliases case-insensitively", () => {
    const ids = (text: string) =>
      filterStudents(ROSTER, { ...base, text, scope: "all" }).map((s) => s.id);
    expect(ids("RIVKA")).toEqual(["c"]);
    expect(ids("cohen")).toEqual(["a", "b"]);
    expect(ids("mimi")).toEqual(["a"]);
    expect(ids("  noam ")).toEqual(["d"]);
  });

  it("matches a full first-and-last name and combines with the scope", () => {
    expect(
      filterStudents(ROSTER, { ...base, text: "miriam cohen", scope: "all" }),
    ).toHaveLength(1);
    expect(
      filterStudents(ROSTER, { ...base, text: "cohen", scope: "in" }).map(
        (s) => s.id,
      ),
    ).toEqual(["b"]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(
      filterStudents(ROSTER, { ...base, text: "zzz", scope: "all" }),
    ).toEqual([]);
  });
});

describe("describeDiff", () => {
  it("words add only, remove only, both and none", () => {
    expect(describeDiff({ add: ["1", "2", "3"], remove: [] })).toBe("Add 3");
    expect(describeDiff({ add: [], remove: ["1", "2"] })).toBe("Remove 2");
    expect(describeDiff({ add: Array(12).fill("x"), remove: ["1"] })).toBe(
      "Add 12, remove 1",
    );
    expect(describeDiff({ add: [], remove: [] })).toBe("No changes");
  });
});

describe("membersPayload", () => {
  it("omits an empty side so the request only names what changes", () => {
    expect(membersPayload("k", { add: ["a"], remove: [] })).toEqual({
      classId: "k",
      addStudentIds: ["a"],
    });
    expect(membersPayload("k", { add: [], remove: ["b"] })).toEqual({
      classId: "k",
      removeStudentIds: ["b"],
    });
    expect(membersPayload("k", { add: ["a"], remove: ["b"] })).toEqual({
      classId: "k",
      addStudentIds: ["a"],
      removeStudentIds: ["b"],
    });
  });
});

describe("canOpenMembersSheet", () => {
  it("is false until the roster has loaded, so a blank list is never edited", () => {
    expect(canOpenMembersSheet(false)).toBe(false);
    expect(canOpenMembersSheet(true)).toBe(true);
  });
});

describe("memberCountLabel", () => {
  it("shows an em dash while the roster is loading, not a false zero", () => {
    expect(memberCountLabel(0, false)).toBe("—");
    expect(memberCountLabel(undefined, false)).toBe("—");
  });
  it("pluralises once loaded, treating a missing count as zero", () => {
    expect(memberCountLabel(undefined, true)).toBe("0 students");
    expect(memberCountLabel(1, true)).toBe("1 student");
    expect(memberCountLabel(18, true)).toBe("18 students");
  });
});

describe("countLeftWithNoClass", () => {
  const roster = [
    student("a", "Ada", "One", ["3rd"]),
    student("b", "Bo", "Two", ["3rd", "Choir"]),
    student("c", "Cy", "Three", []),
    student("d", "Di", "Four", ["Choir"]),
  ];

  it("counts only students whose sole class is the one being left", () => {
    expect(countLeftWithNoClass(roster, ["a", "b"], "3rd")).toBe(1);
  });
  it("does not count a student who is not in the class at all", () => {
    expect(countLeftWithNoClass(roster, ["c", "d"], "3rd")).toBe(0);
  });
  it("ignores ids that are not on the roster and accepts a Set", () => {
    expect(countLeftWithNoClass(roster, new Set(["a", "zzz"]), "3rd")).toBe(1);
  });
  it("is 0 for an empty selection", () => {
    expect(countLeftWithNoClass(roster, [], "3rd")).toBe(0);
  });
});

describe("describeDiff with stranded students", () => {
  it("appends how many will have no class, only when there are some", () => {
    expect(describeDiff({ add: ["1", "2"], remove: ["3"] }, 1)).toBe(
      "Add 2, remove 1 · 1 will have no class",
    );
    expect(describeDiff({ add: [], remove: ["3"] }, 0)).toBe("Remove 1");
  });
});

describe("studentClassesLine", () => {
  it("says 'Also in' for a student who is (or was) in this class", () => {
    expect(studentClassesLine(["3rd", "Choir"], "3rd", true)).toBe(
      "Also in Choir",
    );
  });
  it("says 'In' for a student who is not in this class", () => {
    expect(studentClassesLine(["Choir", "5th"], "3rd", false)).toBe(
      "In Choir, 5th",
    );
  });
  it("says 'No other class' for a member of only this class", () => {
    expect(studentClassesLine(["3rd"], "3rd", true)).toBe("No other class");
  });
  it("says 'No class yet' for a student with no class at all", () => {
    expect(studentClassesLine([], "3rd", false)).toBe("No class yet");
    expect(studentClassesLine([], "3rd", true)).toBe("No class yet");
  });
});

describe("the 'Show students in…' dropdown mapping", () => {
  it("an empty pick means every class, and any name scopes to that class", () => {
    expect(scopeForClassPick("")).toBe("all");
    expect(scopeForClassPick("Choir")).toEqual({ classGroup: "Choir" });
  });
  it("shows 'All classes' unless a specific class is the active scope", () => {
    expect(classPickOf("all")).toBe("");
    expect(classPickOf("in")).toBe("");
    expect(classPickOf("out")).toBe("");
    expect(classPickOf({ classGroup: "Choir" })).toBe("Choir");
  });
  it("round-trips through filterStudents", () => {
    const roster = [
      student("a", "A", "One", ["3rd"]),
      student("b", "B", "Two", ["Choir"]),
    ];
    const shown = filterStudents(roster, {
      text: "",
      scope: scopeForClassPick("Choir"),
      classId: "3rd",
      className: "3rd",
    });
    expect(shown.map((s) => s.id)).toEqual(["b"]);
  });
});
