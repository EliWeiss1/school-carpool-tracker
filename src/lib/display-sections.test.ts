import { describe, expect, it } from "vitest";

import { groupIntoSections } from "./display-sections";
import type { StudentWithClasses } from "@/types/db";

function student(overrides: Partial<StudentWithClasses> & Pick<StudentWithClasses, "id">): StudentWithClasses {
  return {
    first_name: "Jonah",
    last_name: "Smith",
    aliases: [],
    class_groups: ["K1"],
    status: "waiting",
    arrived_at: null,
    updated_at: "2026-09-02T12:00:00.000Z",
    carpool_id: null,
    ...overrides,
  };
}

describe("groupIntoSections", () => {
  it("groups students by class into one section each", () => {
    const students = [
      student({ id: "s1", class_groups: ["K1"] }),
      student({ id: "s2", class_groups: ["K1"] }),
      student({ id: "s3", class_groups: ["1st"] }),
    ];

    const result = groupIntoSections(students, { sectionKey: "" });

    expect(result.allSections).toHaveLength(2);
    expect(result.allSections[0].students.map((s) => s.id)).toEqual([
      "s1",
      "s2",
    ]);
  });

  it("orders sections K1, K2, then 1st through 5th", () => {
    const students = [
      student({ id: "s5", class_groups: ["5th"] }),
      student({ id: "s2", class_groups: ["2nd"] }),
      student({ id: "sK2", class_groups: ["K2"] }),
      student({ id: "s1", class_groups: ["1st"] }),
      student({ id: "sK1", class_groups: ["K1"] }),
    ];

    const result = groupIntoSections(students, { sectionKey: "" });

    expect(result.allSections.map((s) => s.classGroup)).toEqual([
      "K1",
      "K2",
      "1st",
      "2nd",
      "5th",
    ]);
  });

  it("orders sections by a custom class order when one is passed in", () => {
    // The class list is admin-editable data now (see use-class-groups.ts),
    // not a hardcoded constant -- this proves the live order actually
    // controls section order, e.g. an EC class placed before K1.
    const students = [
      student({ id: "sK1", class_groups: ["K1"] }),
      student({ id: "sEC", class_groups: ["EC Hummingbirds"] }),
    ];

    const result = groupIntoSections(
      students,
      { sectionKey: "" },
      ["EC Hummingbirds", "K1"],
    );

    expect(result.allSections.map((s) => s.classGroup)).toEqual([
      "EC Hummingbirds",
      "K1",
    ]);
  });

  it("falls back to the default order when none is passed", () => {
    const students = [
      student({ id: "s5", class_groups: ["5th"] }),
      student({ id: "sK1", class_groups: ["K1"] }),
    ];

    const result = groupIntoSections(students, { sectionKey: "" });

    expect(result.allSections.map((s) => s.classGroup)).toEqual([
      "K1",
      "5th",
    ]);
  });

  it("puts students with no class into a trailing 'Ungrouped' section", () => {
    const students = [
      student({ id: "s1", class_groups: ["K1"] }),
      student({ id: "s2", class_groups: [] }),
    ];

    const result = groupIntoSections(students, { sectionKey: "" });

    expect(result.allSections.at(-1)?.label).toBe("Ungrouped");
    expect(result.allSections.at(-1)?.students.map((s) => s.id)).toEqual([
      "s2",
    ]);
  });

  it("sorts within a section by last name, matching the flat board's existing rule", () => {
    const students = [
      student({ id: "s1", last_name: "Zephyr" }),
      student({ id: "s2", last_name: "Adams" }),
    ];

    const result = groupIntoSections(students, { sectionKey: "" });

    expect(result.allSections[0].students.map((s) => s.id)).toEqual([
      "s2",
      "s1",
    ]);
  });

  it("labels a section with the bare class name", () => {
    const students = [student({ id: "s1", class_groups: ["3rd"] })];
    const result = groupIntoSections(students, { sectionKey: "" });

    expect(result.allSections[0].label).toBe("3rd");
  });

  it("counts waiting and arrived per section", () => {
    const students = [
      student({ id: "s1", status: "waiting" }),
      student({ id: "s2", status: "arrived" }),
      student({ id: "s3", status: "arrived" }),
    ];

    const result = groupIntoSections(students, { sectionKey: "" });

    expect(result.allSections[0].waiting).toBe(1);
    expect(result.allSections[0].arrived).toBe(2);
  });

  describe("filtering to one section", () => {
    const students = [
      student({ id: "s1", class_groups: ["K1"], status: "waiting" }),
      student({ id: "s2", class_groups: ["1st"], status: "arrived" }),
    ];

    it("shows only the matching section when a filter key is set", () => {
      const all = groupIntoSections(students, { sectionKey: "" });
      const key = all.allSections[0].key;

      const filtered = groupIntoSections(students, { sectionKey: key });

      expect(filtered.sections).toHaveLength(1);
      expect(filtered.sections[0].key).toBe(key);
    });

    it("still reports every section in allSections, for the filter chip row", () => {
      const all = groupIntoSections(students, { sectionKey: "" });
      const key = all.allSections[0].key;

      const filtered = groupIntoSections(students, { sectionKey: key });

      expect(filtered.allSections).toHaveLength(2);
    });

    it("computes totals from only the visible sections", () => {
      const all = groupIntoSections(students, { sectionKey: "" });
      const key = all.allSections[1].key; // the "arrived" student's section

      const filtered = groupIntoSections(students, { sectionKey: key });

      expect(filtered.totals).toEqual({ waiting: 0, arrived: 1 });
    });

    it("scopes visibleIds to only the filtered section's students", () => {
      const all = groupIntoSections(students, { sectionKey: "" });
      const key = all.allSections[0].key;

      const filtered = groupIntoSections(students, { sectionKey: key });

      expect(filtered.visibleIds.has("s1")).toBe(true);
      expect(filtered.visibleIds.has("s2")).toBe(false);
    });

    it("an unknown filter key shows nothing rather than falling back to all", () => {
      const filtered = groupIntoSections(students, {
        sectionKey: "nonexistent",
      });

      expect(filtered.sections).toEqual([]);
      expect(filtered.visibleIds.size).toBe(0);
    });
  });

  it("with no filter, visibleIds covers the whole roster", () => {
    const students = [
      student({ id: "s1", class_groups: ["K1"] }),
      student({ id: "s2", class_groups: ["1st"] }),
    ];

    const result = groupIntoSections(students, { sectionKey: "" });

    expect(result.visibleIds.size).toBe(2);
  });

  it("produces one filter option per section, each carrying its waiting count", () => {
    const students = [
      student({ id: "s1", class_groups: ["K1"], status: "waiting" }),
      student({ id: "s2", class_groups: ["K1"], status: "waiting" }),
      student({ id: "s3", class_groups: ["1st"], status: "arrived" }),
    ];

    const result = groupIntoSections(students, { sectionKey: "" });

    expect(result.options).toEqual([
      { key: expect.any(String), label: "K1", waiting: 2 },
      { key: expect.any(String), label: "1st", waiting: 0 },
    ]);
  });

  it("returns nothing for an empty roster", () => {
    const result = groupIntoSections([], { sectionKey: "" });

    expect(result.allSections).toEqual([]);
    expect(result.sections).toEqual([]);
    expect(result.options).toEqual([]);
    expect(result.totals).toEqual({ waiting: 0, arrived: 0 });
  });

  describe("students in more than one class", () => {
    const twoClass = student({
      id: "twin",
      last_name: "Cohen",
      class_groups: ["K1", "2nd"],
      status: "arrived",
    });
    const k1Only = student({ id: "a", class_groups: ["K1"] });
    const secondOnly = student({ id: "b", class_groups: ["2nd"] });

    it("a two-class student appears in both sections", () => {
      const result = groupIntoSections([twoClass, k1Only, secondOnly], {
        sectionKey: "",
      });

      const idsIn = (label: string) =>
        result.allSections
          .find((section) => section.label === label)
          ?.students.map((s) => s.id);
      expect(idsIn("K1")).toEqual(expect.arrayContaining(["twin", "a"]));
      expect(idsIn("2nd")).toEqual(expect.arrayContaining(["twin", "b"]));
    });

    it("counts them in every section they are in", () => {
      const result = groupIntoSections([twoClass, k1Only, secondOnly], {
        sectionKey: "",
      });

      const k1 = result.allSections.find((s) => s.label === "K1");
      const second = result.allSections.find((s) => s.label === "2nd");
      expect([k1?.arrived, k1?.waiting]).toEqual([1, 1]);
      expect([second?.arrived, second?.waiting]).toEqual([1, 1]);
    });

    it("totals count them once", () => {
      const result = groupIntoSections([twoClass, k1Only, secondOnly], {
        sectionKey: "",
      });

      expect(result.totals).toEqual({ waiting: 2, arrived: 1 });
    });

    it("visibleIds is the union with no duplicates", () => {
      const result = groupIntoSections([twoClass, k1Only, secondOnly], {
        sectionKey: "",
      });

      expect(result.visibleIds.size).toBe(3);
      expect([...result.visibleIds].sort()).toEqual(["a", "b", "twin"]);
    });

    it("a student with no classes is only Ungrouped", () => {
      const loner = student({ id: "loner", class_groups: [] });
      const result = groupIntoSections([twoClass, loner], { sectionKey: "" });

      const holders = result.allSections
        .filter((section) => section.students.some((s) => s.id === "loner"))
        .map((section) => section.label);
      expect(holders).toEqual(["Ungrouped"]);
    });

    it("filtering to one class shows its multi-class students", () => {
      const result = groupIntoSections([twoClass, k1Only, secondOnly], {
        sectionKey: "2nd",
      });

      expect(result.sections.map((s) => s.label)).toEqual(["2nd"]);
      expect([...result.visibleIds].sort()).toEqual(["b", "twin"]);
      expect(result.totals).toEqual({ waiting: 1, arrived: 1 });
    });

    it("filter option counts keep their per-section meaning", () => {
      const result = groupIntoSections(
        [student({ ...twoClass, status: "waiting" }), k1Only],
        { sectionKey: "" },
      );

      expect(result.options).toEqual([
        { key: expect.any(String), label: "K1", waiting: 2 },
        { key: expect.any(String), label: "2nd", waiting: 1 },
      ]);
    });
  });

  describe("filter options when the class list is known", () => {
    const classOrder = ["K1", "1st", "6th grade", "7th grade"];

    it("lists every class in class-list order, including empty ones", () => {
      const students = [
        student({ id: "s1", class_groups: ["1st"] }),
        student({ id: "s2", class_groups: ["K1"], status: "arrived" }),
      ];

      const { options } = groupIntoSections(students, { sectionKey: "" }, classOrder);

      expect(options.map((o) => [o.label, o.waiting])).toEqual([
        ["K1", 0],
        ["1st", 1],
        ["6th grade", 0],
        ["7th grade", 0],
      ]);
    });

    it("keeps the board itself free of empty headings", () => {
      const students = [student({ id: "s1", class_groups: ["K1"] })];

      const result = groupIntoSections(students, { sectionKey: "" }, classOrder);

      expect(result.allSections.map((s) => s.label)).toEqual(["K1"]);
      expect(result.sections.map((s) => s.label)).toEqual(["K1"]);
    });

    it("adds Ungrouped last only when a student has no class", () => {
      const withClassless = groupIntoSections(
        [student({ id: "s1", class_groups: [] })],
        { sectionKey: "" },
        classOrder,
      );
      const without = groupIntoSections(
        [student({ id: "s1", class_groups: ["K1"] })],
        { sectionKey: "" },
        classOrder,
      );

      expect(withClassless.options.at(-1)?.label).toBe("Ungrouped");
      expect(withClassless.options).toHaveLength(classOrder.length + 1);
      expect(without.options.map((o) => o.label)).not.toContain("Ungrouped");
    });

    it("appends a section whose class is not on the list after the listed ones", () => {
      const students = [
        student({ id: "s1", class_groups: ["Mystery"] }),
        student({ id: "s2", class_groups: [] }),
      ];

      const { options } = groupIntoSections(students, { sectionKey: "" }, classOrder);

      expect(options.map((o) => o.label)).toEqual([
        ...classOrder,
        "Mystery",
        "Ungrouped",
      ]);
    });

    it.each([[undefined], [[]]])(
      "derives options from the sections when the list is %j",
      (order) => {
        const students = [
          student({ id: "s1", class_groups: ["1st"] }),
          student({ id: "s2", class_groups: ["K1"] }),
        ];

        const { options } = groupIntoSections(
          students,
          { sectionKey: "" },
          order as string[] | undefined,
        );

        expect(options.map((o) => o.label)).toEqual(["K1", "1st"]);
      },
    );

    it("still counts a two-class student once in the totals", () => {
      const students = [
        student({ id: "s1", class_groups: ["K1", "1st"] }),
        student({ id: "s2", class_groups: ["1st"], status: "arrived" }),
      ];

      const result = groupIntoSections(students, { sectionKey: "" }, classOrder);

      expect(result.totals).toEqual({ waiting: 1, arrived: 1 });
      expect(result.options.map((o) => [o.label, o.waiting])).toEqual([
        ["K1", 1],
        ["1st", 1],
        ["6th grade", 0],
        ["7th grade", 0],
      ]);
    });

    it("filtering to an empty class shows nothing and counts nothing", () => {
      const students = [student({ id: "s1", class_groups: ["K1"] })];

      const result = groupIntoSections(
        students,
        { sectionKey: "6th grade" },
        classOrder,
      );

      expect(result.sections).toEqual([]);
      expect(result.visibleIds.size).toBe(0);
      expect(result.totals).toEqual({ waiting: 0, arrived: 0 });
    });
  });
});
