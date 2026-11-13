import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * No endpoint may exist that skips the guard, and none may ask for less than it
 * should.
 *
 * Every function directory's `index.ts` wires one handler module, and that
 * module is where the guard call lives. Reading the two together is the only
 * check that a new endpoint was not added without authentication, or with the
 * wrong capability: a handler that forgot `guardRequest` would still compile and
 * would still pass its own tests.
 */

const FUNCTIONS_DIR = __dirname;
const HANDLERS_DIR = join(FUNCTIONS_DIR, "_shared", "handlers");

/** What each endpoint that predates schools must require, by directory name. */
const EXPECTED_CAPABILITY: Record<string, "announce" | "office"> = {
  "deepgram-token": "announce",
  "resolve-name": "announce",
  "set-status": "announce",
  "roster-list": "office",
  "roster-write": "office",
  "roster-delete": "office",
  "roster-import": "office",
  "roster-reset": "office",
  "carpool-write": "office",
  "classes-write": "office",
};

const GUARDED =
  /\bguardRequest\(\s*[^,()]+,\s*[^,()]+,\s*"(announce|office)"\s*\)/;
const SESSION_GUARDED =
  /\bguardSessionRequest\(\s*[^,()]+,\s*[^,()]+,\s*"(announce|office)"\s*\)/;
const AUTHENTICATED = /\bauthenticateRequest\(/;

/** A handler reading the school off the body instead of off the guard. */
const BODY_SCHOOL_ID =
  /body(\.schoolId|\[\s*["']schoolId["']\s*\])|readString\([^)]*["']schoolId["']/;

function functionDirs(): string[] {
  return readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name);
}

/** The handler module an entrypoint imports from `../_shared/handlers/`. */
function handlerSourceOf(dir: string): { file: string; source: string } {
  const index = readFileSync(join(FUNCTIONS_DIR, dir, "index.ts"), "utf8");
  const imported = /from\s+"\.\.\/_shared\/handlers\/([\w-]+)\.ts"/.exec(index);
  if (!imported?.[1]) {
    throw new Error(`${dir}/index.ts imports no handler from _shared/handlers`);
  }
  const file = join(HANDLERS_DIR, `${imported[1]}.ts`);
  return { file, source: readFileSync(file, "utf8") };
}

describe("auth boundary", () => {
  it("finds the ten endpoints that predate schools", () => {
    for (const name of Object.keys(EXPECTED_CAPABILITY)) {
      expect(existsSync(join(FUNCTIONS_DIR, name, "index.ts")), name).toBe(
        true,
      );
    }
  });

  it.each(functionDirs())("%s's handler authenticates every request", (dir) => {
    const { file, source } = handlerSourceOf(dir);
    const ok =
      GUARDED.test(source) ||
      SESSION_GUARDED.test(source) ||
      AUTHENTICATED.test(source);
    expect(
      ok,
      `${file} must call guardRequest/guardSessionRequest with a literal "announce" or "office", or authenticateRequest`,
    ).toBe(true);
  });

  it.each(Object.entries(EXPECTED_CAPABILITY))(
    "%s requires the %s capability",
    (dir, capability) => {
      const { source } = handlerSourceOf(dir);
      const found = GUARDED.exec(source) ?? SESSION_GUARDED.exec(source);
      expect(found?.[1]).toBe(capability);
    },
  );

  it.each(functionDirs())(
    "%s's handler never reads the school from the request body",
    (dir) => {
      // `GuardResult.schoolId` is the checked one; the body's is only a claim.
      const { file, source } = handlerSourceOf(dir);
      expect(
        BODY_SCHOOL_ID.test(source),
        `${file} reads schoolId from the body`,
      ).toBe(false);
    },
  );
});
