import { describe, expect, it } from "vitest";

import { splitFullName } from "./split-name";

describe("splitFullName", () => {
  it("splits First Last", () => {
    expect(splitFullName("Miriam Cohen")).toEqual({
      first_name: "Miriam",
      last_name: "Cohen",
    });
  });
  it("treats a comma as Last, First", () => {
    expect(splitFullName("Cohen, Miriam")).toEqual({
      first_name: "Miriam",
      last_name: "Cohen",
    });
  });
  it("keeps a middle name with the first name after a comma", () => {
    expect(splitFullName("Cohen, Miriam Leah")).toEqual({
      first_name: "Miriam Leah",
      last_name: "Cohen",
    });
  });
  it("keeps surname particles together", () => {
    expect(splitFullName("Anna van der Berg")).toEqual({
      first_name: "Anna",
      last_name: "van der Berg",
    });
    expect(splitFullName("Moshe ben David")).toEqual({
      first_name: "Moshe",
      last_name: "ben David",
    });
  });
  it("keeps a generational suffix on the surname", () => {
    expect(splitFullName("John Smith Jr")).toEqual({
      first_name: "John",
      last_name: "Smith Jr",
    });
  });
  it("honours last-first order without a comma", () => {
    expect(splitFullName("Cohen Miriam", "last-first")).toEqual({
      first_name: "Miriam",
      last_name: "Cohen",
    });
  });
  it("returns null for a single word or empty", () => {
    expect(splitFullName("Miriam")).toBeNull();
    expect(splitFullName("   ")).toBeNull();
  });
  it("tolerates extra spaces", () => {
    expect(splitFullName("  Miriam    Cohen  ")).toEqual({
      first_name: "Miriam",
      last_name: "Cohen",
    });
  });
});
