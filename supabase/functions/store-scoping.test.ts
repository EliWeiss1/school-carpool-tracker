import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The Deno store cannot run in Vitest, and the service-role key it uses
 * bypasses row-level security, so nothing in the database stops a query from
 * crossing schools. This test is the substitute guard: it reads the file and
 * fails if any query is made outside `scopedClient`, the one function that adds
 * the school to every read and write.
 */

const STORE_FILE = join(__dirname, "_shared", "supabase-store.deno.ts");

const SCOPED_RPCS = [
  "set_student_classes",
  "change_class_members",
  "remove_class_group",
];

/** Comments say `.from(` in prose; only code counts. Offsets are preserved. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/\/\/.*$/gm, (line) => " ".repeat(line.length));
}

/** The span of the braces of `function name(...) { ... }`. */
function bodyOf(source: string, name: string): { start: number; end: number } {
  const header = source.indexOf(`function ${name}(`);
  if (header === -1) throw new Error(`function ${name} not found`);

  // Skip the parameter list and return type to the body's opening brace.
  let depth = 0;
  let open = -1;
  for (let i = source.indexOf("(", header); i < source.length; i++) {
    const ch = source[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "{" && depth === 0) {
      open = i;
      break;
    }
  }

  depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return { start: open, end: i };
  }
  throw new Error(`function ${name} is not closed`);
}

function blank(source: string, span: { start: number; end: number }): string {
  return (
    source.slice(0, span.start) +
    " ".repeat(span.end - span.start) +
    source.slice(span.end)
  );
}

describe("supabase-store.deno.ts query scoping", () => {
  const code = stripComments(readFileSync(STORE_FILE, "utf8"));
  const scoped = bodyOf(code, "scopedClient");
  const outside = blank(code, scoped);

  it("makes no .from( call outside scopedClient", () => {
    expect(outside.match(/\.from\(/g) ?? []).toEqual([]);
  });

  it("makes no raw client.rpc( call outside scopedClient", () => {
    // `db.rpc(` is the scoped helper; any other receiver is a bare client.
    const raw = [...outside.matchAll(/(\w+)\s*\.rpc\(/g)].filter(
      (match) => match[1] !== "db",
    );
    expect(raw).toEqual([]);
  });

  it("creates one supabase client, and only to scope it", () => {
    expect(code.match(/createClient\(/g)).toHaveLength(1);
    expect(code.match(/scopedClient\(client,/g)).toHaveLength(1);

    // Outside the factory and the helper, nothing may even name the bare client.
    const withoutFactory = blank(outside, bodyOf(code, "createSupabaseStores"));
    expect(withoutFactory.match(/\bclient\b(?!:\s*Client)/g) ?? []).toEqual([]);
  });

  it("calls only the three p_school_id functions", () => {
    const used = [...outside.matchAll(/\.rpc\(\s*"([a-z_]+)"/g)].map(
      (match) => match[1],
    );
    expect(used.length).toBeGreaterThan(0);
    for (const name of used) expect(SCOPED_RPCS).toContain(name);

    // The helper can only be asked for those three, and always sends the school.
    const declared = /type SchoolRpc =([^;]*);/.exec(code)?.[1] ?? "";
    expect(
      [...declared.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]).sort(),
    ).toEqual([...SCOPED_RPCS].sort());
    expect(code.slice(scoped.start, scoped.end)).toContain(
      "p_school_id: schoolId",
    );
  });

  it("stamps school_id after the caller's values and filters every read", () => {
    const helper = code.slice(scoped.start, scoped.end);
    expect(helper).toMatch(/\{\s*\.\.\.row,\s*school_id:\s*schoolId\s*\}/);
    // select, update and delete each carry the school filter.
    expect(helper.match(/\.eq\("school_id", schoolId\)/g)).toHaveLength(3);
  });
});
