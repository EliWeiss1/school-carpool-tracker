import { describe, expect, it } from "vitest";
import { SAMPLE_ROSTER } from "./roster";
import {
  attachInsertedIds,
  buildStudentClassLinks,
  UnknownClassError,
} from "./student-class-links";

const classIds = new Map([
  ["K1", "class-k1"],
  ["K2", "class-k2"],
  ["1st", "class-1st"],
]);

describe("buildStudentClassLinks", () => {
  it("emits one link per student-class pair, resolved to class ids", () => {
    const links = buildStudentClassLinks(
      [
        { studentId: "s1", class_groups: ["K1"] },
        { studentId: "s2", class_groups: ["K1", "1st"] },
      ],
      classIds,
    );

    expect(links).toEqual([
      { student_id: "s1", class_group_id: "class-k1" },
      { student_id: "s2", class_group_id: "class-k1" },
      { student_id: "s2", class_group_id: "class-1st" },
    ]);
  });

  it("matches class names case-insensitively, as the unique index does", () => {
    const links = buildStudentClassLinks(
      [{ studentId: "s1", class_groups: ["k2"] }],
      classIds,
    );
    expect(links).toEqual([{ student_id: "s1", class_group_id: "class-k2" }]);
  });

  it("collapses a class listed twice into one link", () => {
    const links = buildStudentClassLinks(
      [{ studentId: "s1", class_groups: ["K1", "K1"] }],
      classIds,
    );
    expect(links).toHaveLength(1);
  });

  it("names every unknown class in the error instead of failing on the first", () => {
    expect(() =>
      buildStudentClassLinks(
        [
          { studentId: "s1", class_groups: ["6th"] },
          { studentId: "s2", class_groups: ["K1", "7th", "6th"] },
        ],
        classIds,
      ),
    ).toThrowError(UnknownClassError);

    try {
      buildStudentClassLinks(
        [{ studentId: "s1", class_groups: ["6th", "7th", "6th"] }],
        classIds,
      );
    } catch (err) {
      expect((err as UnknownClassError).missing).toEqual(["6th", "7th"]);
      expect((err as Error).message).toContain("6th");
      expect((err as Error).message).toContain("7th");
    }
  });
});

describe("attachInsertedIds", () => {
  it("pairs each roster entry with the id the database gave that student", () => {
    const paired = attachInsertedIds(
      [
        { first_name: "Maya", last_name: "Cohen", class_groups: ["K1"] },
        { first_name: "Ari", last_name: "Kohen", class_groups: ["K1", "K2"] },
      ],
      [
        { id: "id-ari", first_name: "Ari", last_name: "Kohen" },
        { id: "id-maya", first_name: "Maya", last_name: "Cohen" },
      ],
    );

    expect(paired).toEqual([
      { studentId: "id-maya", class_groups: ["K1"] },
      { studentId: "id-ari", class_groups: ["K1", "K2"] },
    ]);
  });

  it("throws when an inserted student is missing from the returned rows", () => {
    expect(() =>
      attachInsertedIds(
        [{ first_name: "Maya", last_name: "Cohen", class_groups: ["K1"] }],
        [],
      ),
    ).toThrowError(/Maya Cohen/);
  });
});

describe("links for the real sample roster", () => {
  const known = new Map(
    ["K1", "K2", "1st", "2nd", "3rd", "4th", "5th"].map((n) => [n, `id-${n}`]),
  );

  it("builds one link per membership: 105 primary plus six second classes", () => {
    const entries = SAMPLE_ROSTER.map((s, i) => ({
      studentId: `s${i}`,
      class_groups: s.class_groups,
    }));
    const links = buildStudentClassLinks(entries, known);

    expect(links).toHaveLength(111);
    expect(new Set(links.map((l) => l.student_id)).size).toBe(105);
  });
});
