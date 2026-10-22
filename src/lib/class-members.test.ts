import { describe, expect, it } from "vitest";

import type { RosterStudent } from "./admin-api";
import {
  describeDiff,
  diffMembership,
  filterStudents,
  canOpenMembersSheet,
  hasChanges,
  memberCountLabel,
  memberIdsOf,
  membersPayload,
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
