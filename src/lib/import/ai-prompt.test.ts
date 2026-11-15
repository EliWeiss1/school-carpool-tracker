import { describe, expect, it } from "vitest";

import { parseRosterCsv } from "../csv-import";
import { IDEAL_HEADINGS, SAMPLE_CSV, buildAiPrompt } from "./ai-prompt";

describe("buildAiPrompt", () => {
  it("includes every class name and the headings line", () => {
    const prompt = buildAiPrompt(["K1", "2nd", "Choir"]);
    for (const name of ["K1", "2nd", "Choir"]) expect(prompt).toContain(name);
    expect(prompt).toContain(IDEAL_HEADINGS.join(","));
  });
  it("works with no classes", () => {
    const prompt = buildAiPrompt([]);
    expect(prompt).toContain(IDEAL_HEADINGS.join(","));
    expect(prompt).not.toContain("named exactly");
  });
});

describe("SAMPLE_CSV", () => {
  it("parses into four students with no errors", () => {
    const report = parseRosterCsv(SAMPLE_CSV);
    expect(report.headerErrors).toEqual([]);
    expect(report.errors).toEqual([]);
    expect(report.toImport).toHaveLength(4);
    const yosef = report.toImport.find((s) => s.first_name === "Yosef");
    expect(yosef?.last_name).toBe("Levy");
    expect(yosef?.class_groups).toEqual(["3rd", "Choir"]);
  });
});
