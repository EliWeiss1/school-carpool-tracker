import { describe, expect, it } from "vitest";

import { LEGACY_SCHOOL_ID } from "../functions/_shared/schools.ts";
import { parseSeedTarget } from "./seed-target";

describe("parseSeedTarget", () => {
  it("targets the original school when no school is named", () => {
    expect(parseSeedTarget([])).toEqual({
      ok: true,
      allowRemote: false,
      school: { by: "id", id: LEGACY_SCHOOL_ID },
    });
  });

  it("targets a school by its web address", () => {
    expect(parseSeedTarget(["--school", "oak-hill"])).toMatchObject({
      ok: true,
      school: { by: "slug", slug: "oak-hill" },
    });
    expect(parseSeedTarget(["--school=oak-hill"])).toMatchObject({
      ok: true,
      school: { by: "slug", slug: "oak-hill" },
    });
  });

  it("reads --allow-remote wherever it appears", () => {
    expect(
      parseSeedTarget(["--allow-remote", "--school", "oak-hill"]),
    ).toMatchObject({ ok: true, allowRemote: true });
    expect(
      parseSeedTarget(["--school", "oak-hill", "--allow-remote"]),
    ).toMatchObject({ ok: true, allowRemote: true });
  });

  it("refuses a hosted project unless the school is named", () => {
    // On a hosted project the unnamed default is the original school: real
    // children and their history. Wiping it has to be said out loud.
    const unnamed = parseSeedTarget(["--allow-remote"]);
    expect(unnamed.ok).toBe(false);
    if (!unnamed.ok) expect(unnamed.error).toMatch(/--school/);

    expect(
      parseSeedTarget(["--allow-remote", "--school", "my-school"]).ok,
    ).toBe(true);
  });

  it("refuses --school with nothing after it rather than guessing", () => {
    // Falling back to the original school here would wipe the wrong roster.
    expect(parseSeedTarget(["--school"]).ok).toBe(false);
    expect(parseSeedTarget(["--school", "--allow-remote"]).ok).toBe(false);
    expect(parseSeedTarget(["--school="]).ok).toBe(false);
  });

  it("refuses something that is not a web address", () => {
    for (const bad of ["Oak Hill", "a", "oak_hill", "-oak", "oak-"]) {
      expect(parseSeedTarget(["--school", bad]).ok).toBe(false);
    }
  });

  it("refuses two schools at once", () => {
    expect(parseSeedTarget(["--school", "oak-hill", "--school=elm"]).ok).toBe(
      false,
    );
  });
});
