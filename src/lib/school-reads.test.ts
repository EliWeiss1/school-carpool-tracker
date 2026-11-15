import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { fetchClassGroups } from "@/lib/class-groups";
import { fetchStudentsWithClasses } from "@/lib/student-classes";
import type { Database } from "@/types/db";

/** A query-builder double that records the calls made on it, then resolves. */
function fakeClient(result: { data: unknown[]; error: null }) {
  const calls: string[] = [];
  const builder: Record<string, unknown> = {
    select: (s: string) => (calls.push(`select ${s}`), builder),
    order: (c: string) => (calls.push(`order ${c}`), builder),
    eq: (c: string, v: string) => (calls.push(`eq ${c} ${v}`), builder),
    returns: () => builder,
    then: (resolve: (r: typeof result) => unknown) => resolve(result),
  };
  const client = {
    from: (t: string) => (calls.push(`from ${t}`), builder),
  } as unknown as SupabaseClient<Database>;
  return { client, calls };
}

describe("fetchStudentsWithClasses", () => {
  it("adds no filter on the legacy route", async () => {
    const f = fakeClient({ data: [], error: null });
    await fetchStudentsWithClasses(f.client, null);
    expect(f.calls.some((c) => c.startsWith("eq"))).toBe(false);
    expect(f.calls[0]).toBe("from students");
  });

  it("filters by school when given one", async () => {
    const f = fakeClient({ data: [], error: null });
    await fetchStudentsWithClasses(f.client, "sch-1");
    expect(f.calls).toContain("eq school_id sch-1");
  });
});

describe("fetchClassGroups", () => {
  it("adds no filter on the legacy route", async () => {
    const f = fakeClient({ data: [], error: null });
    await fetchClassGroups(f.client);
    expect(f.calls.some((c) => c.startsWith("eq"))).toBe(false);
  });

  it("filters by school when given one", async () => {
    const f = fakeClient({ data: [], error: null });
    await fetchClassGroups(f.client, "sch-1");
    expect(f.calls).toContain("eq school_id sch-1");
  });
});
