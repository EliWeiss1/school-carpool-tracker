import { describe, expect, it } from "vitest";

import { groupIntoSections } from "./display-sections";
import type { Student } from "@/types/db";

function student(overrides: Partial<Student> & Pick<Student, "id">): Student {
  return {
    first_name: "Jonah",
    last_name: "Smith",
    aliases: [],
    grade: "K",
    class_group: "K-Alvarez",
    status: "waiting",
    arrived_at: null,
    updated_at: "2026-09-02T12:00:00.000Z",
    carpool_id: null,
    ...overrides,
  };
}

describe("groupIntoSections", () => {
  it("groups students by grade + class into one section each", () => {
    const students = [
      student({ id: "s1", grade: "K", class_group: "K-Alvarez" }),
      student({ id: "s2", grade: "K", class_group: "K-Alvarez" }),
      student({ id: "s3", grade: "1", class_group: "1-Reyes" }),
    ];

    const result = groupIntoSections(students, { sectionKey: "" });

    expect(result.allSections).toHaveLength(2);
    expect(result.allSections[0].students.map((s) => s.id)).toEqual([
      "s1",
      "s2",
    ]);
  });

  it("orders sections by grade, K before 1, and numerically after that", () => {
    const students = [
      student({ id: "s10", grade: "10", class_group: "A" }),
      student({ id: "s2", grade: "2", class_group: "A" }),
      student({ id: "sK", grade: "K", class_group: "A" }),
      student({ id: "s1", grade: "1", class_group: "A" }),
    ];

    const result = groupIntoSections(students, { sectionKey: "" });

    expect(result.allSections.map((s) => s.grade)).toEqual([
      "K",
      "1",
      "2",
      "10",
    ]);
  });

  it("puts students with no grade or class into a trailing 'Ungrouped' section", () => {
    const students = [
      student({ id: "s1", grade: "K", class_group: "A" }),
      student({ id: "s2", grade: null, class_group: null }),
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

  it("labels a section 'Grade N · Class'", () => {
    const students = [student({ id: "s1", grade: "3", class_group: "Foxes" })];
    const result = groupIntoSections(students, { sectionKey: "" });

    expect(result.allSections[0].label).toBe("Grade 3 · Foxes");
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
      student({ id: "s1", grade: "K", class_group: "A", status: "waiting" }),
      student({ id: "s2", grade: "1", class_group: "B", status: "arrived" }),
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
      student({ id: "s1", grade: "K" }),
      student({ id: "s2", grade: "1" }),
    ];

    const result = groupIntoSections(students, { sectionKey: "" });

    expect(result.visibleIds.size).toBe(2);
  });

  it("produces one filter option per section, each carrying its waiting count", () => {
    const students = [
      student({ id: "s1", grade: "K", class_group: "A", status: "waiting" }),
      student({ id: "s2", grade: "K", class_group: "A", status: "waiting" }),
      student({ id: "s3", grade: "1", class_group: "B", status: "arrived" }),
    ];

    const result = groupIntoSections(students, { sectionKey: "" });

    expect(result.options).toEqual([
      { key: expect.any(String), label: "Grade K · A", waiting: 2 },
      { key: expect.any(String), label: "Grade 1 · B", waiting: 0 },
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
