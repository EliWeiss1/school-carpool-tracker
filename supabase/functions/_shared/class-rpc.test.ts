import { describe, expect, it } from "vitest";

import {
  COLLISION_MESSAGE,
  classNamesFor,
  parseChangeMembersResult,
  parseRemoveClassGroupResult,
  classWriteFailure,
} from "./class-rpc.ts";
import { RequestError, withStoreErrors } from "./http.ts";

describe("parseRemoveClassGroupResult", () => {
  it("maps a deletion to movedCount", () => {
    expect(
      parseRemoveClassGroupResult({ deleted: true, moved_count: 4 }),
    ).toEqual({ status: "deleted", movedCount: 4 });
  });

  it("maps a refusal to needs-decision with its sample", () => {
    const sole = { id: "s1", first_name: "Maya", last_name: "Cohen" };
    expect(
      parseRemoveClassGroupResult({
        deleted: false,
        member_count: 5,
        sole_member_count: 2,
        sole_members: [sole],
      }),
    ).toEqual({
      status: "needs-decision",
      memberCount: 5,
      soleMemberCount: 2,
      soleMembers: [sole],
    });
  });

  it("throws on anything else", () => {
    expect(() => parseRemoveClassGroupResult(null)).toThrow(/remove_class_group/);
    expect(() => parseRemoveClassGroupResult({ deleted: "yes" })).toThrow(
      /remove_class_group/,
    );
    expect(() =>
      parseRemoveClassGroupResult({ deleted: true, moved_count: "4" }),
    ).toThrow(/remove_class_group/);
    expect(() =>
      parseRemoveClassGroupResult({
        deleted: false,
        member_count: 1,
        sole_member_count: 1,
        sole_members: [{ id: "s1" }],
      }),
    ).toThrow(/remove_class_group/);
  });
});

describe("parseChangeMembersResult", () => {
  it("maps member_count and ignored_ids", () => {
    expect(
      parseChangeMembersResult({ member_count: 7, ignored_ids: ["a", "b"] }),
    ).toEqual({ memberCount: 7, ignoredIds: ["a", "b"] });
  });

  it("throws on a malformed result", () => {
    expect(() => parseChangeMembersResult(undefined)).toThrow(
      /change_class_members/,
    );
    expect(() =>
      parseChangeMembersResult({ member_count: 1, ignored_ids: [1] }),
    ).toThrow(/change_class_members/);
    expect(() =>
      parseChangeMembersResult({ member_count: "1", ignored_ids: [] }),
    ).toThrow(/change_class_members/);
  });
});

describe("classWriteFailure", () => {
  it("turns a deadlock or serialization failure into the retry sentence", () => {
    expect(classWriteFailure({ code: "40P01", message: "deadlock detected" }, "x").message).toBe(
      COLLISION_MESSAGE,
    );
    expect(classWriteFailure({ code: "40001", message: "could not serialize" }, "x").message).toBe(
      COLLISION_MESSAGE,
    );
    expect(COLLISION_MESSAGE).toBe(
      "That change collided with another one. Try again.",
    );
  });

  it("explains a foreign-key failure as a class that went away", () => {
    expect(classWriteFailure({ code: "23503", message: "fk" }, "x").message).toMatch(
      /no longer exists/,
    );
  });

  it("turns a malformed id (22P02) into a plain-sentence 400, not a 503 with Postgres text", async () => {
    const failure = classWriteFailure(
      { code: "22P02", message: 'invalid input syntax for type uuid: "abc"' },
      "Could not remove that class",
    );
    expect(failure).toBeInstanceOf(RequestError);
    expect((failure as RequestError).status).toBe(400);
    expect(failure.message).not.toMatch(/uuid|syntax/);

    // End to end through the shared wrapper the handlers use.
    const response = await withStoreErrors(async () => {
      throw failure;
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: failure.message });
  });

  it("prefixes any other failure with the action", () => {
    expect(
      classWriteFailure({ code: "XX000", message: "boom" }, "Could not remove that class").message,
    ).toBe("Could not remove that class: boom");
    expect(
      classWriteFailure({ message: "network down" }, "Could not remove that class").message,
    ).toBe("Could not remove that class: network down");
  });
});

describe("classNamesFor", () => {
  const groups = [
    { id: "a", name: "5th", sort_order: 6 },
    { id: "b", name: "K1", sort_order: 0 },
    { id: "c", name: "2nd", sort_order: 3 },
  ];

  it("returns names in class sort_order, deduplicating ids", () => {
    expect(classNamesFor(groups, ["a", "b", "a"])).toEqual(["K1", "5th"]);
  });

  it("skips ids that are not in the list", () => {
    expect(classNamesFor(groups, ["zzz", "c"])).toEqual(["2nd"]);
    expect(classNamesFor(groups, [])).toEqual([]);
  });
});
