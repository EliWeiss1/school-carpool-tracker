import { describe, expect, it } from "vitest";

import { legacyScope, scopedStorageKey } from "./screen-access";

const school = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "A",
  slug: "a",
};
const other = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "B",
  slug: "b",
};

describe("scopedStorageKey", () => {
  it("leaves the legacy routes' keys exactly as they were", () => {
    // A board already on a wall must keep its remembered class filter.
    expect(scopedStorageKey(null, "display-class-filter")).toBe(
      "display-class-filter",
    );
  });

  it("gives each school its own key for the same preference", () => {
    const a = scopedStorageKey(school, "display-class-filter");
    const b = scopedStorageKey(other, "display-class-filter");

    expect(a).not.toBe(b);
    expect(a).toContain(school.id);
    expect(a).not.toBe(scopedStorageKey(null, "display-class-filter"));
  });

  it("keys on the school's id, so renaming a school loses nothing", () => {
    expect(
      scopedStorageKey({ ...school, name: "Renamed", slug: "renamed" }, "x"),
    ).toBe(scopedStorageKey(school, "x"));
  });
});

describe("legacyScope", () => {
  it("is no school, with unprefixed keys", () => {
    expect(legacyScope.school).toBeNull();
    expect(legacyScope.storageKey("anything")).toBe("anything");
  });
});
