import { describe, expect, it, vi } from "vitest";

import { ApiError } from "./api";
import { classDeleteDecision, createAdminApiClient } from "./admin-api";

const BASE = "https://example.test/functions/v1";
const CREDENTIALS = { pin: "123456", deviceId: "device-a" };

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function clientReturning(...responses: Response[]) {
  const fetchImpl = vi.fn();
  for (const response of responses) {
    fetchImpl.mockResolvedValueOnce(response);
  }
  const client = createAdminApiClient({
    baseUrl: BASE,
    anonKey: "anon-key",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return { client, fetchImpl };
}

function firstRequest(fetchImpl: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
  return {
    url,
    init,
    body: JSON.parse(String(init.body)) as Record<string, unknown>,
    headers: init.headers as Record<string, string>,
  };
}

describe("listRoster", () => {
  it("posts to roster-list with the anon key and an optional scope", async () => {
    const { client, fetchImpl } = clientReturning(
      jsonResponse({ students: [] }),
    );

    await client.listRoster({ ...CREDENTIALS, classGroup: "K1" });
    const sent = firstRequest(fetchImpl);

    expect(sent.url).toBe(BASE + "/roster-list");
    expect(sent.headers.authorization).toBe("Bearer anon-key");
    expect(sent.body).toMatchObject({ ...CREDENTIALS, classGroup: "K1" });
  });

  it("returns the students from the response", async () => {
    const student = { id: "s1", first_name: "Maya", last_name: "Cohen" };
    const { client } = clientReturning(jsonResponse({ students: [student] }));

    const result = await client.listRoster(CREDENTIALS);

    expect(result.students).toEqual([student]);
  });
});

describe("createStudent", () => {
  it("posts to roster-write with no studentId", async () => {
    const { client, fetchImpl } = clientReturning(
      jsonResponse({
        student: { id: "s1", first_name: "Theo", last_name: "Ng" },
        created: true,
      }),
    );

    await client.createStudent({
      ...CREDENTIALS,
      first_name: "Theo",
      last_name: "Ng",
      aliases: ["Eng"],
      class_groups: ["1st", "Choir"],
    });
    const sent = firstRequest(fetchImpl);

    expect(sent.url).toBe(BASE + "/roster-write");
    expect(sent.body).not.toHaveProperty("studentId");
    expect(sent.body).toMatchObject({
      first_name: "Theo",
      last_name: "Ng",
      aliases: ["Eng"],
    });
  });

  it("createStudent sends class_groups", async () => {
    const { client, fetchImpl } = clientReturning(
      jsonResponse({ student: { id: "s1" }, created: true }),
    );

    await client.createStudent({
      ...CREDENTIALS,
      first_name: "Theo",
      last_name: "Ng",
      class_groups: ["1st", "Choir"],
    });

    expect(firstRequest(fetchImpl).body.class_groups).toEqual(["1st", "Choir"]);
  });
});

describe("updateStudent", () => {
  it("posts only the fields that were actually passed", async () => {
    const { client, fetchImpl } = clientReturning(
      jsonResponse({
        student: { id: "cohen", class_groups: ["2nd"] },
        created: false,
      }),
    );

    await client.updateStudent({
      ...CREDENTIALS,
      studentId: "cohen",
      class_groups: ["2nd"],
    });
    const sent = firstRequest(fetchImpl);

    expect(sent.body).toEqual({
      ...CREDENTIALS,
      studentId: "cohen",
      class_groups: ["2nd"],
    });
    expect(sent.body).not.toHaveProperty("first_name");
    expect(sent.body).not.toHaveProperty("aliases");
  });

  it("omits class_groups when undefined but sends [] to clear every class", async () => {
    // compact() drops empty-looking values; updateStudent builds its body by
    // hand so "leave the classes alone" (omit) and "remove them all" ([])
    // stay distinguishable.
    const { client, fetchImpl } = clientReturning(
      jsonResponse({ student: { id: "cohen" }, created: false }),
      jsonResponse({ student: { id: "cohen" }, created: false }),
    );

    await client.updateStudent({
      ...CREDENTIALS,
      studentId: "cohen",
      first_name: "Maya",
    });
    await client.updateStudent({
      ...CREDENTIALS,
      studentId: "cohen",
      class_groups: [],
    });
    const calls = fetchImpl.mock.calls as [string, RequestInit][];
    const first = JSON.parse(String(calls[0][1].body)) as Record<
      string,
      unknown
    >;
    const second = JSON.parse(String(calls[1][1].body)) as Record<
      string,
      unknown
    >;

    expect("class_groups" in first).toBe(false);
    expect(second.class_groups).toEqual([]);
  });
});

describe("deleteStudent", () => {
  it("posts to roster-delete", async () => {
    const { client, fetchImpl } = clientReturning(
      jsonResponse({ deletedIds: ["cohen"], missingIds: [] }),
    );

    const result = await client.deleteStudent({
      ...CREDENTIALS,
      studentId: "cohen",
    });
    const sent = firstRequest(fetchImpl);

    expect(sent.url).toBe(BASE + "/roster-delete");
    expect(sent.body.studentId).toBe("cohen");
    expect(result.deletedIds).toEqual(["cohen"]);
  });
});

describe("deleteStudents", () => {
  it("posts the plural studentIds to roster-delete", async () => {
    const { client, fetchImpl } = clientReturning(
      jsonResponse({ deletedIds: ["cohen", "ng"], missingIds: [] }),
    );

    const result = await client.deleteStudents({
      ...CREDENTIALS,
      studentIds: ["cohen", "ng"],
    });
    const sent = firstRequest(fetchImpl);

    expect(sent.url).toBe(BASE + "/roster-delete");
    expect(sent.body.studentIds).toEqual(["cohen", "ng"]);
    expect(result.deletedIds).toEqual(["cohen", "ng"]);
  });
});

describe("importRoster", () => {
  it("posts the confirmed rows to roster-import", async () => {
    const { client, fetchImpl } = clientReturning(
      jsonResponse({ created: 2, students: [] }),
    );

    const row = (first_name: string, last_name: string) => ({
      first_name,
      last_name,
      aliases: [],
      class_group: null,
      carpool: null,
      parent1_name: null,
      parent2_name: null,
    });

    await client.importRoster({
      ...CREDENTIALS,
      students: [row("Theo", "Ng"), row("Nora", "Chen")],
    });
    const sent = firstRequest(fetchImpl);

    expect(sent.url).toBe(BASE + "/roster-import");
    expect(sent.body.students).toHaveLength(2);
  });
});

describe("resetAllToWaiting", () => {
  it("posts to roster-reset with just credentials", async () => {
    const { client, fetchImpl } = clientReturning(
      jsonResponse({ reset: 3, logged: 3 }),
    );

    const result = await client.resetAllToWaiting(CREDENTIALS);
    const sent = firstRequest(fetchImpl);

    expect(sent.url).toBe(BASE + "/roster-reset");
    expect(sent.body).toEqual(CREDENTIALS);
    expect(result).toEqual({ reset: 3, logged: 3 });
  });
});

describe("carpools", () => {
  it("creates a carpool with the create action and optional members", async () => {
    const { client, fetchImpl } = clientReturning(
      jsonResponse({
        carpool: { id: "weiss", name: "Weiss Carpool" },
        members: [],
        created: true,
      }),
    );

    await client.createCarpool({
      ...CREDENTIALS,
      name: "Weiss Carpool",
      memberIds: ["s1", "s2"],
    });
    const sent = firstRequest(fetchImpl);

    expect(sent.url).toBe(BASE + "/carpool-write");
    expect(sent.body).toMatchObject({
      action: "create",
      name: "Weiss Carpool",
      memberIds: ["s1", "s2"],
    });
  });

  it("sends an empty memberIds array on update, to clear membership, distinct from omitting it", async () => {
    const { client, fetchImpl } = clientReturning(
      jsonResponse({
        carpool: { id: "weiss", name: "Weiss Carpool" },
        members: [],
        created: false,
      }),
    );

    await client.updateCarpool({
      ...CREDENTIALS,
      carpoolId: "weiss",
      memberIds: [],
    });
    const sent = firstRequest(fetchImpl);

    expect(sent.body.action).toBe("update");
    expect(sent.body.memberIds).toEqual([]);
  });

  it("omits memberIds entirely when the caller does not pass it", async () => {
    const { client, fetchImpl } = clientReturning(
      jsonResponse({
        carpool: { id: "weiss", name: "Renamed" },
        members: [],
        created: false,
      }),
    );

    await client.updateCarpool({
      ...CREDENTIALS,
      carpoolId: "weiss",
      name: "Renamed",
    });

    expect(firstRequest(fetchImpl).body).not.toHaveProperty("memberIds");
  });

  it("deletes a carpool with the delete action", async () => {
    const { client, fetchImpl } = clientReturning(
      jsonResponse({ deleted: true }),
    );

    const result = await client.deleteCarpool({
      ...CREDENTIALS,
      carpoolId: "weiss",
    });
    const sent = firstRequest(fetchImpl);

    expect(sent.body).toMatchObject({ action: "delete", carpoolId: "weiss" });
    expect(result.deleted).toBe(true);
  });
});

describe("class membership", () => {
  it("deleteClass sends moveToClassId and force", async () => {
    const { client, fetchImpl } = clientReturning(
      jsonResponse({ deleted: true, movedCount: 4 }),
    );

    const result = await client.deleteClass({
      ...CREDENTIALS,
      classId: "c1",
      moveToClassId: "c2",
      force: true,
    });
    const sent = firstRequest(fetchImpl);

    expect(sent.url).toBe(BASE + "/classes-write");
    expect(sent.body).toEqual({
      ...CREDENTIALS,
      action: "delete",
      classId: "c1",
      moveToClassId: "c2",
      force: true,
    });
    expect(result).toEqual({ deleted: true, movedCount: 4 });
  });

  it("deleteClass leaves moveToClassId and force off the wire when unset", async () => {
    const { client, fetchImpl } = clientReturning(
      jsonResponse({ deleted: true, movedCount: 0 }),
    );

    await client.deleteClass({ ...CREDENTIALS, classId: "c1" });
    const sent = firstRequest(fetchImpl);

    expect(sent.body).not.toHaveProperty("moveToClassId");
    expect(sent.body).not.toHaveProperty("force");
  });

  it("deleteClass 409 rejects with the decision payload", async () => {
    const decision = {
      memberCount: 5,
      soleMemberCount: 2,
      soleMembers: [
        { id: "s1", first_name: "Maya", last_name: "Cohen" },
        { id: "s2", first_name: "Theo", last_name: "Ng" },
      ],
    };
    const { client } = clientReturning(
      jsonResponse(
        { error: "2 students are only in this class.", ...decision },
        409,
      ),
    );

    const error = (await client
      .deleteClass({ ...CREDENTIALS, classId: "c1" })
      .catch((caught: unknown) => caught)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe("conflict");
    expect(error.status).toBe(409);
    expect(error.message).toBe("2 students are only in this class.");
    expect(error.details).toEqual(decision);
  });

  it("classDeleteDecision reads the payload back, and rejects anything else", () => {
    const decision = { memberCount: 1, soleMemberCount: 0, soleMembers: [] };
    const conflict = new ApiError("conflict", 409, "x", null, decision);
    expect(classDeleteDecision(conflict)).toEqual(decision);
    expect(classDeleteDecision(new ApiError("conflict", 409, "x"))).toBeNull();
    expect(classDeleteDecision(new ApiError("pin", 401, "x"))).toBeNull();
    expect(classDeleteDecision(new Error("x"))).toBeNull();
  });

  it("a 409 without a decision payload still rejects, with no details", async () => {
    const { client } = clientReturning(
      jsonResponse({ error: 'A class named "K1" already exists.' }, 409),
    );

    const error = (await client
      .createClass({ ...CREDENTIALS, name: "K1" })
      .catch((caught: unknown) => caught)) as ApiError;

    expect(error.kind).toBe("conflict");
    expect(error.message).toBe('A class named "K1" already exists.');
    expect(error.details).toBeNull();
  });

  it('changeClassMembers posts to classes-write with action "members"', async () => {
    const { client, fetchImpl } = clientReturning(
      jsonResponse({ memberCount: 7, ignoredIds: ["ghost"] }),
    );

    const result = await client.changeClassMembers({
      ...CREDENTIALS,
      classId: "c1",
      addStudentIds: ["s1"],
      removeStudentIds: ["s2"],
    });
    const sent = firstRequest(fetchImpl);

    expect(sent.url).toBe(BASE + "/classes-write");
    expect(sent.body).toEqual({
      ...CREDENTIALS,
      action: "members",
      classId: "c1",
      addStudentIds: ["s1"],
      removeStudentIds: ["s2"],
    });
    expect(result).toEqual({ memberCount: 7, ignoredIds: ["ghost"] });
  });
});

describe("error handling", () => {
  it("turns a 401 into a pin ApiError a caller can branch on", async () => {
    const { client } = clientReturning(
      jsonResponse({ error: "That PIN was not recognised." }, 401),
    );

    const failure = await client
      .listRoster(CREDENTIALS)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).kind).toBe("pin");
    expect((failure as ApiError).message).toBe("That PIN was not recognised.");
  });

  it("turns a 429 into a throttled ApiError carrying retry-after", async () => {
    const { client } = clientReturning(
      jsonResponse({ error: "Too many requests." }, 429, {
        "retry-after": "30",
      }),
    );

    const failure = await client
      .resetAllToWaiting(CREDENTIALS)
      .catch((error: unknown) => error);

    expect((failure as ApiError).kind).toBe("throttled");
    expect((failure as ApiError).retryAfterSeconds).toBe(30);
  });

  it("turns a network failure into a network ApiError", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const client = createAdminApiClient({
      baseUrl: BASE,
      anonKey: "anon-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const failure = await client
      .listRoster(CREDENTIALS)
      .catch((error: unknown) => error);

    expect((failure as ApiError).kind).toBe("network");
  });

  it("falls back to a readable message when the server sends no error body", async () => {
    const { client } = clientReturning(
      new Response("<html>Bad Gateway</html>", { status: 502 }),
    );

    const failure = await client
      .listRoster(CREDENTIALS)
      .catch((error: unknown) => error);

    // The kind is a transport fact and is shared with api.ts. The words are
    // not: an office screen must never be told to "type the name instead",
    // and a 502 reaching /admin is Supabase's gateway, not the speech service.
    expect((failure as ApiError).message).toBe(
      "The board is not reachable right now. Try again shortly.",
    );
    expect((failure as ApiError).message).not.toMatch(/speech|type the name/i);
  });
});

describe("admin-api shares the app's transport", () => {
  // These duplicated api.ts's transport wholesale, which meant they also
  // duplicated a bug that had already been fixed there: a missing env var
  // surfaced as "check the wifi" instead of naming the setup problem. The
  // office computer is exactly where an unconfigured deployment gets noticed.
  it("reports a missing anon key as a setup fault, not a network fault", async () => {
    const fetchImpl = vi.fn();
    const client = createAdminApiClient({
      baseUrl: BASE,
      anonKey: undefined,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const error = (await client
      .listRoster(CREDENTIALS)
      .catch((caught: unknown) => caught)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe("unavailable");
    expect(error.message).toMatch(/not set up|installed/i);
    expect(error.message).not.toMatch(/wifi/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("still maps a wrong PIN to the pin kind", async () => {
    const { client } = clientReturning(
      jsonResponse({ error: "That PIN was not recognised." }, 401),
    );

    const error = (await client
      .listRoster(CREDENTIALS)
      .catch((caught: unknown) => caught)) as ApiError;

    expect(error.kind).toBe("pin");
  });

  it("honours retry-after when the office is throttled", async () => {
    const { client } = clientReturning(
      jsonResponse({ error: "Too many." }, 429, { "retry-after": "30" }),
    );

    const error = (await client
      .listRoster(CREDENTIALS)
      .catch((caught: unknown) => caught)) as ApiError;

    expect(error.retryAfterSeconds).toBe(30);
  });
});
