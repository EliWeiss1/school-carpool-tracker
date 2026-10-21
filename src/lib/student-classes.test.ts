import { describe, expect, it } from "vitest";

import { STUDENT_WITH_CLASSES_SELECT, withClassNames } from "./student-classes";
import type { Student } from "@/types/db";

const BASE: Student = {
  id: "s1",
  first_name: "Maya",
  last_name: "Cohen",
  aliases: [],
  status: "waiting",
  arrived_at: null,
  updated_at: "2026-10-21T00:00:00Z",
  carpool_id: null,
};

const link = (name: string, sort_order: number) => ({
  class_groups: { name, sort_order },
});

describe("STUDENT_WITH_CLASSES_SELECT", () => {
  it("embeds the class names and their order", () => {
    expect(STUDENT_WITH_CLASSES_SELECT).toBe(
      "*, student_classes(class_groups(name, sort_order))",
    );
  });
});

describe("withClassNames", () => {
  it("sorts by sort_order then name", () => {
    const result = withClassNames({
      ...BASE,
      student_classes: [link("2nd", 3), link("Choir", 9), link("1st", 3)],
    });
    expect(result.class_groups).toEqual(["1st", "2nd", "Choir"]);
  });

  it("strips the embed", () => {
    const result = withClassNames({
      ...BASE,
      student_classes: [link("K1", 1)],
    });
    expect(result).not.toHaveProperty("student_classes");
    expect(result.first_name).toBe("Maya");
  });

  it("yields [] for a student with no links", () => {
    expect(
      withClassNames({ ...BASE, student_classes: [] }).class_groups,
    ).toEqual([]);
    expect(withClassNames({ ...BASE }).class_groups).toEqual([]);
  });

  it("ignores a link whose class row is null", () => {
    const result = withClassNames({
      ...BASE,
      student_classes: [{ class_groups: null }, link("K2", 2)],
    });
    expect(result.class_groups).toEqual(["K2"]);
  });

  it("does not mutate its input", () => {
    const embed = [link("B", 2), link("A", 1)];
    withClassNames({ ...BASE, student_classes: embed });
    expect(embed.map((e) => e.class_groups?.name)).toEqual(["B", "A"]);
  });
});
