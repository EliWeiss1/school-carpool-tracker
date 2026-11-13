import { describe, expect, it } from "vitest";

import {
  type Row,
  type ScopableClient,
  scopedClient,
} from "./scoped-client.ts";

const SCHOOL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SCHOOL_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

interface Call {
  op: "select" | "update" | "delete" | "insert" | "upsert" | "rpc";
  target: string;
  payload?: unknown;
  options?: unknown;
  filters: [string, string][];
}

interface RecordedQuery {
  eq(column: string, value: string): RecordedQuery;
}

/** A stand-in for supabase-js that only writes down what it was asked. */
function recorder() {
  const calls: Call[] = [];
  const record = (call: Call): RecordedQuery => {
    calls.push(call);
    const query: RecordedQuery = {
      eq(column, value) {
        call.filters.push([column, value]);
        return query;
      },
    };
    return query;
  };

  const client: ScopableClient<RecordedQuery> = {
    from: (table) => ({
      select: (columns) =>
        record({ op: "select", target: table, payload: columns, filters: [] }),
      update: (patch) =>
        record({ op: "update", target: table, payload: patch, filters: [] }),
      delete: () => record({ op: "delete", target: table, filters: [] }),
      insert: (rows) =>
        record({ op: "insert", target: table, payload: rows, filters: [] }),
      upsert: (row, options) =>
        record({
          op: "upsert",
          target: table,
          payload: row,
          options,
          filters: [],
        }),
    }),
    rpc: (name, args) =>
      record({ op: "rpc", target: name, payload: args, filters: [] }),
  };
  return { client, calls };
}

describe("scopedClient", () => {
  it("filters every read by the school", () => {
    const { client, calls } = recorder();
    scopedClient(client, SCHOOL_A).select("students", "*");

    expect(calls).toEqual([
      {
        op: "select",
        target: "students",
        payload: "*",
        filters: [["school_id", SCHOOL_A]],
      },
    ]);
  });

  it("filters every update by the school", () => {
    const { client, calls } = recorder();
    scopedClient(client, SCHOOL_A).update("students", { status: "arrived" });

    expect(calls[0]?.filters).toEqual([["school_id", SCHOOL_A]]);
  });

  it("filters every delete by the school", () => {
    const { client, calls } = recorder();
    scopedClient(client, SCHOOL_A).remove("carpools");

    expect(calls[0]).toMatchObject({
      op: "delete",
      target: "carpools",
      filters: [["school_id", SCHOOL_A]],
    });
  });

  it("stamps the school on an inserted row", () => {
    const { client, calls } = recorder();
    scopedClient(client, SCHOOL_A).insert("carpools", { name: "Levy" });

    expect(calls[0]?.payload).toEqual({ name: "Levy", school_id: SCHOOL_A });
  });

  it("stamps the school on every row of a bulk insert", () => {
    const { client, calls } = recorder();
    scopedClient(client, SCHOOL_A).insert("students", [
      { last_name: "Cohen" },
      { last_name: "Kohen" },
    ]);

    expect(calls[0]?.payload).toEqual([
      { last_name: "Cohen", school_id: SCHOOL_A },
      { last_name: "Kohen", school_id: SCHOOL_A },
    ]);
  });

  it("stamps the school on an upsert and passes its conflict target on", () => {
    const { client, calls } = recorder();
    scopedClient(client, SCHOOL_A).upsert(
      "student_parents",
      { student_id: "s1", parent1_name: "Dana" },
      "school_id,student_id",
    );

    expect(calls[0]).toMatchObject({
      payload: { student_id: "s1", parent1_name: "Dana", school_id: SCHOOL_A },
      options: { onConflict: "school_id,student_id" },
    });
  });

  it("sends the school to every database function", () => {
    const { client, calls } = recorder();
    scopedClient(client, SCHOOL_A).rpc("set_student_classes", {
      p_student_id: "s1",
      p_class_group_ids: [],
    });

    expect(calls[0]).toMatchObject({
      op: "rpc",
      target: "set_student_classes",
      payload: {
        p_student_id: "s1",
        p_class_group_ids: [],
        p_school_id: SCHOOL_A,
      },
    });
  });

  // The rows below carry another school's id, as a row built carelessly from a
  // request body could. Whatever the caller wrote, the scope's school wins.
  it("lets no caller-supplied school_id through on insert", () => {
    const { client, calls } = recorder();
    scopedClient(client, SCHOOL_A).insert("students", [
      { last_name: "Cohen", school_id: SCHOOL_B },
    ]);

    expect(calls[0]?.payload).toEqual([
      { last_name: "Cohen", school_id: SCHOOL_A },
    ]);
  });

  it("lets no caller-supplied school_id through on upsert", () => {
    const { client, calls } = recorder();
    scopedClient(client, SCHOOL_A).upsert(
      "student_parents",
      { student_id: "s1", school_id: SCHOOL_B },
      "school_id,student_id",
    );

    expect(calls[0]?.payload).toEqual({
      student_id: "s1",
      school_id: SCHOOL_A,
    });
  });

  it("cannot be used to move a row to another school with an update", () => {
    const { client, calls } = recorder();
    scopedClient(client, SCHOOL_A).update("students", {
      last_name: "Cohen",
      school_id: SCHOOL_B,
    });

    expect(calls[0]?.payload).toEqual({
      last_name: "Cohen",
      school_id: SCHOOL_A,
    });
  });

  it("lets no caller-supplied p_school_id through to a function", () => {
    const { client, calls } = recorder();
    const args: Row = { p_student_id: "s1", p_school_id: SCHOOL_B };
    // The type forbids this; a cast or a spread of untyped data would not.
    scopedClient(client, SCHOOL_A).rpc("set_student_classes", args as never);

    expect(calls[0]?.payload).toEqual({
      p_student_id: "s1",
      p_school_id: SCHOOL_A,
    });
  });

  it("does not change the caller's own objects", () => {
    const { client } = recorder();
    const row = { name: "Levy" };
    scopedClient(client, SCHOOL_A).insert("carpools", row);

    expect(row).toEqual({ name: "Levy" });
  });

  it("refuses to be built for anything that is not a school id", () => {
    const { client } = recorder();
    for (const bad of ["", "school-a", `${SCHOOL_A} or 1=1`]) {
      expect(() => scopedClient(client, bad)).toThrow();
    }
  });

  it("keeps two schools' scopes apart", () => {
    const { client, calls } = recorder();
    const a = scopedClient(client, SCHOOL_A);
    const b = scopedClient(client, SCHOOL_B);
    a.insert("carpools", { name: "Levy" });
    b.insert("carpools", { name: "Levy" });
    a.select("carpools", "*");

    expect(calls.map((call) => call.payload)).toEqual([
      { name: "Levy", school_id: SCHOOL_A },
      { name: "Levy", school_id: SCHOOL_B },
      "*",
    ]);
    expect(calls[2]?.filters).toEqual([["school_id", SCHOOL_A]]);
  });
});
