import { describe, expect, it } from "vitest";

import { flattenClassNames } from "./class-embed.ts";

const link = (name: string, sort_order: number) => ({
  class_groups: { name, sort_order },
});

describe("flattenClassNames", () => {
  it("sorts by sort_order then name", () => {
    const embed = [
      link("5th", 6),
      link("K2", 1),
      link("Chess", 9),
      link("Art", 9),
      link("K1", 0),
    ];
    expect(flattenClassNames(embed)).toEqual(["K1", "K2", "5th", "Art", "Chess"]);
  });

  it("does not mutate the embed it was given", () => {
    const embed = [link("B", 2), link("A", 1)];
    flattenClassNames(embed);
    expect(embed.map((l) => l.class_groups.name)).toEqual(["B", "A"]);
  });

  it("treats null class rows as absent", () => {
    const embed = [{ class_groups: null }, link("1st", 2)];
    expect(flattenClassNames(embed)).toEqual(["1st"]);
  });

  it("returns an empty list for a student in no class", () => {
    expect(flattenClassNames([])).toEqual([]);
  });

  it("throws on a non-array embed", () => {
    expect(() => flattenClassNames(null)).toThrow(/student_classes/);
    expect(() => flattenClassNames(undefined)).toThrow(/student_classes/);
    expect(() => flattenClassNames({ class_groups: link("K1", 0) })).toThrow(
      /student_classes/,
    );
  });

  it("throws when a link is not an object with a to-one class_groups", () => {
    expect(() => flattenClassNames(["K1"])).toThrow(/student_classes/);
    expect(() => flattenClassNames([null])).toThrow(/student_classes/);
    expect(() => flattenClassNames([{ class_groups: [link("K1", 0)] }])).toThrow(
      /student_classes/,
    );
    expect(() =>
      flattenClassNames([{ class_groups: { name: 3, sort_order: 0 } }]),
    ).toThrow(/student_classes/);
    expect(() =>
      flattenClassNames([{ class_groups: { name: "K1", sort_order: "0" } }]),
    ).toThrow(/student_classes/);
  });
});
