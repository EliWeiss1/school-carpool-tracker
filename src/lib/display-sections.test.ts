import { describe, expect, it } from "vitest";

import { groupIntoSections } from "./display-sections";
import type { Student } from "@/types/db";

function student(overrides: Partial<Student> & Pick<Student, "id">): Student {
  return {
    first_name: "Jonah",
    last_name: "Smith",
    aliases: [],
    class_group: "K1",
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
      student({ id: "s1", class_group: "K1" }),
      student({ id: "s2", class_group: "K1" }),
      student({ id: "s3", class_group: "1st" }),
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
      student({ id: "s5", class_group: "5th" }),
      student({ id: "s2", class_group: "2nd" }),
      student({ id: "sK2", class_group: "K2" }),
      student({ id: "s1", class_group: "1st" }),
      student({ id: "sK1", class_group: "K1" }),
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

  it("puts students with no class into a trailing 'Ungrouped' section", () => {
    const students = [
      student({ id: "s1", class_group: "K1" }),
      student({ id: "s2", class_group: null }),
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
    const students = [student({ id: "s1", class_group: "3rd" })];
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
      student({ id: "s1", class_group: "K1", status: "waiting" }),
      student({ id: "s2", class_group: "1st", status: "arrived" }),
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
      student({ id: "s1", class_group: "K1" }),
      student({ id: "s2", class_group: "1st" }),
    ];

    const result = groupIntoSections(students, { sectionKey: "" });

    expect(result.visibleIds.size).toBe(2);
  });

  it("produces one filter option per section, each carrying its waiting count", () => {
    const students = [
      student({ id: "s1", class_group: "K1", status: "waiting" }),
      student({ id: "s2", class_group: "K1", status: "waiting" }),
      student({ id: "s3", class_group: "1st", status: "arrived" }),
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
});
