import { describe, expect, it } from "vitest";

import {
  buildStudentFields,
  type StudentFormValues,
} from "./student-form-fields";

const VALUES: StudentFormValues = {
  firstName: "  Maya ",
  lastName: "Cohen",
  aliasesText: "Kohen; Cohn,  ",
  selectedClasses: ["K1"],
  carpoolId: "",
  parent1Name: " ",
  parent2Name: "Dana Cohen",
};

describe("buildStudentFields", () => {
  it("on create always sends class_groups and trims every text field", () => {
    expect(buildStudentFields(VALUES)).toEqual({
      first_name: "Maya",
      last_name: "Cohen",
      aliases: ["Kohen", "Cohn"],
      class_groups: ["K1"],
      carpool_id: null,
      parent1_name: null,
      parent2_name: "Dana Cohen",
    });
  });

  it("on create sends [] when no class is ticked", () => {
    expect(
      buildStudentFields({ ...VALUES, selectedClasses: [] }).class_groups,
    ).toEqual([]);
  });

  it("omits the class_groups key on a name-only edit", () => {
    // Another admin may have bulk-added this student to a class since the form
    // opened; re-sending the form's stale set would silently undo that.
    const fields = buildStudentFields(
      { ...VALUES, firstName: "Mayah", selectedClasses: ["2nd", "K1"] },
      { class_groups: ["K1", "2nd"] },
    );
    expect("class_groups" in fields).toBe(false);
    expect(fields.first_name).toBe("Mayah");
  });

  it("sends class_groups on an edit that changed the classes", () => {
    const fields = buildStudentFields(
      { ...VALUES, selectedClasses: ["K1", "2nd"] },
      { class_groups: ["K1"] },
    );
    expect(fields.class_groups).toEqual(["K1", "2nd"]);
  });

  it("sends [] on an edit that unticked every class", () => {
    const fields = buildStudentFields(
      { ...VALUES, selectedClasses: [] },
      { class_groups: ["K1"] },
    );
    expect(fields.class_groups).toEqual([]);
  });

  it("passes a chosen carpool id through", () => {
    expect(
      buildStudentFields({ ...VALUES, carpoolId: "cp-1" }).carpool_id,
    ).toBe("cp-1");
  });
});
