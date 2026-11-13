import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The Deno store cannot run in Vitest, and the service-role key it uses
 * bypasses row-level security, so nothing in the database stops a query from
 * crossing schools. This test is the substitute guard: it reads the file and
 * fails if the store builds any query itself instead of asking `scopedClient`
 * (scoped-client.ts), the one function that adds the school to every read and
 * write. What `scopedClient` does with a query is not checked here by reading:
 * it is runtime-neutral and unit-tested in scoped-client.test.ts.
 */

const STORE_FILE = join(__dirname, "_shared", "supabase-store.deno.ts");
const SCOPE_FILE = join(__dirname, "_shared", "scoped-client.ts");

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
  const scope = stripComments(readFileSync(SCOPE_FILE, "utf8"));

  it("builds no query itself: there is no .from( anywhere in the store", () => {
    expect(code.match(/\.from\(/g) ?? []).toEqual([]);
  });

  it("calls no database function except through the scope", () => {
    // `db.rpc(` is the scoped helper; any other receiver is a bare client.
    const raw = [...code.matchAll(/(\w+)\s*\.rpc\(/g)].filter(
      (match) => match[1] !== "db",
    );
    expect(raw).toEqual([]);
  });

  it("takes its scope from scoped-client.ts and defines none of its own", () => {
    expect(code).toMatch(
      /import \{[^}]*\bscopedClient\b[^}]*\} from "\.\/scoped-client\.ts";/,
    );
    expect(code).not.toMatch(/function scopedClient\(/);
    expect(code).not.toMatch(/const scopedClient\b/);
  });

  it("creates one supabase client, and only to scope it", () => {
    expect(code.match(/createClient\(/g)).toHaveLength(1);
    expect(code.match(/\bscopedClient\(/g)).toHaveLength(1);

    // Outside the factory, nothing may even name the bare client. (The
    // lookbehind keeps the import path "scoped-client.ts" from counting.)
    const outsideFactory = blank(code, bodyOf(code, "createSupabaseStores"));
    expect(outsideFactory.match(/(?<![-\w])client\b/g) ?? []).toEqual([]);

    // Inside it, the client is created, and handed to the scope. Nothing else.
    const factory = bodyOf(code, "createSupabaseStores");
    const uses = code
      .slice(factory.start, factory.end)
      .match(/(?<![-\w])client\b(?!\s*=)/g);
    expect(uses).toHaveLength(1);
  });

  it("calls only the three p_school_id functions", () => {
    const used = [...code.matchAll(/\.rpc\(\s*"([a-z_]+)"/g)].map(
      (match) => match[1],
    );
    expect(used.length).toBeGreaterThan(0);
    for (const name of used) expect(SCOPED_RPCS).toContain(name);

    // The scope can only be asked for those three.
    const declared = /type SchoolRpc =([^;]*);/.exec(scope)?.[1] ?? "";
    expect(
      [...declared.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]).sort(),
    ).toEqual([...SCOPED_RPCS].sort());
  });

  it("proves it can fail: a raw query added to the store is caught", () => {
    const tampered = `${code}\nclient.from("students").select("*");`;
    expect(tampered.match(/\.from\(/g) ?? []).not.toEqual([]);
  });
});
