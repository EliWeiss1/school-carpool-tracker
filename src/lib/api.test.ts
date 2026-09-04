import { describe, expect, it, vi } from "vitest";

import { ApiError, createApiClient } from "./api";

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
  const client = createApiClient({
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

describe("request shape", () => {
  it("posts to the named endpoint with the anon key and a JSON body", async () => {
    const { client, fetchImpl } = clientReturning(
      jsonResponse({ token: "t", expiresIn: 30, keyterms: ["Cohen"] }),
    );

    await client.requestToken({ ...CREDENTIALS, classGroup: "3rd" });
    const sent = firstRequest(fetchImpl);

    expect(sent.url).toBe(BASE + "/deepgram-token");
    expect(sent.init.method).toBe("POST");
    expect(sent.headers.authorization).toBe("Bearer anon-key");
    expect(sent.headers.apikey).toBe("anon-key");
    expect(sent.headers["content-type"]).toContain("application/json");
    expect(sent.body).toMatchObject({
      pin: "123456",
      deviceId: "device-a",
      classGroup: "3rd",
    });
  });

  it("omits absent optional fields rather than sending nulls", async () => {
    const { client, fetchImpl } = clientReturning(
      jsonResponse({ token: "t", expiresIn: 30, keyterms: [] }),
    );

    await client.requestToken(CREDENTIALS);

    expect(firstRequest(fetchImpl).body).not.toHaveProperty("classGroup");
  });

  it("sends source on every status write, because the server requires it", async () => {
    const { client, fetchImpl } = clientReturning(
      jsonResponse({
        students: [{ id: "s1" }],
        changed: ["s1"],
        logged: 1,
        missing: [],
      }),
    );

    await client.setStatus({
      ...CREDENTIALS,
      studentId: "s1",
      status: "arrived",
      source: "voice",
      matchConfidence: 0.93,
      transcript: "Cohen",
    });

    expect(firstRequest(fetchImpl).body).toMatchObject({
      studentId: "s1",
      status: "arrived",
      source: "voice",
      matchConfidence: 0.93,
      transcript: "Cohen",
    });
  });

  it("passes Deepgram alternatives through when the caller has them", async () => {
    const { client, fetchImpl } = clientReturning(
      jsonResponse({ tier: "none", transcript: "", candidates: [] }),
    );

    await client.resolveName({
      ...CREDENTIALS,
      alternatives: [{ transcript: "cohen", confidence: 0.8 }],
    });

    expect(firstRequest(fetchImpl).body.alternatives).toEqual([
      { transcript: "cohen", confidence: 0.8 },
    ]);
  });
});

describe("successful responses", () => {
  it("returns the three-tier resolve payload untouched", async () => {
    const payload = {
      tier: "ambiguous",
      transcript: "cohen",
      candidates: [
        {
          students: [
            {
              id: "s1",
              first_name: "Maya",
              last_name: "Cohen",
              class_group: "3rd",
              status: "waiting",
            },
          ],
          carpool: null,
          score: 0.91,
          matchedOn: "Cohen",
          matchedVia: "surname",
        },
      ],
    };
    const { client } = clientReturning(jsonResponse(payload));

    await expect(
      client.resolveName({ ...CREDENTIALS, transcript: "cohen" }),
    ).resolves.toEqual(payload);
  });

  it("treats tier none as success, not as a fault", async () => {
    const { client } = clientReturning(
      jsonResponse({ tier: "none", transcript: "gwen", candidates: [] }),
    );

    const result = await client.resolveName({
      ...CREDENTIALS,
      transcript: "gwen",
    });

    expect(result.tier).toBe("none");
  });

  it("surfaces an empty changed list for an already-arrived student", async () => {
    const { client } = clientReturning(
      jsonResponse({
        students: [{ id: "s1", status: "arrived" }],
        changed: [],
        logged: 0,
        missing: [],
      }),
    );

    const result = await client.setStatus({
      ...CREDENTIALS,
      studentId: "s1",
      status: "arrived",
      source: "manual",
    });

    expect(result.changed).toEqual([]);
    expect(result.students[0].status).toBe("arrived");
  });
});

describe("errors staff have to read", () => {
  const cases = [
    { status: 401, kind: "pin" },
    { status: 429, kind: "throttled" },
    { status: 502, kind: "speech" },
    { status: 503, kind: "unavailable" },
    { status: 400, kind: "request" },
    { status: 404, kind: "request" },
  ] as const;

  for (const { status, kind } of cases) {
    it(
      "maps " + status + " to kind " + kind + " and shows the server sentence",
      async () => {
        const { client } = clientReturning(
          jsonResponse(
            { error: "A sentence a staff member can act on." },
            status,
          ),
        );

        const error = await client
          .resolveName({ ...CREDENTIALS, transcript: "cohen" })
          .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).kind).toBe(kind);
        expect((error as ApiError).status).toBe(status);
        expect((error as ApiError).message).toBe(
          "A sentence a staff member can act on.",
        );
      },
    );
  }

  it("honours retry-after on a 429", async () => {
    const { client } = clientReturning(
      jsonResponse({ error: "Too many." }, 429, { "retry-after": "45" }),
    );

    const error = (await client
      .setStatus({
        ...CREDENTIALS,
        studentId: "s1",
        status: "arrived",
        source: "manual",
      })
      .catch((caught: unknown) => caught)) as ApiError;

    expect(error.retryAfterSeconds).toBe(45);
  });

  it("leaves retryAfterSeconds null when the header is missing or junk", async () => {
    const { client } = clientReturning(
      jsonResponse({ error: "Too many." }, 429, { "retry-after": "soon" }),
    );

    const error = (await client
      .requestToken(CREDENTIALS)
      .catch((caught: unknown) => caught)) as ApiError;

    expect(error.retryAfterSeconds).toBeNull();
  });

  it("falls back to a readable sentence when the body carries no error field", async () => {
    const { client } = clientReturning(
      new Response("<html>502</html>", { status: 502 }),
    );

    const error = (await client
      .requestToken(CREDENTIALS)
      .catch((caught: unknown) => caught)) as ApiError;

    expect(error.kind).toBe("speech");
    expect(error.message).toMatch(/type the name/i);
  });

  it("reports a dead network as a network error, not a crash", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    const client = createApiClient({
      baseUrl: BASE,
      anonKey: "anon-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const error = (await client
      .requestToken(CREDENTIALS)
      .catch((caught: unknown) => caught)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe("network");
    expect(error.status).toBe(0);
    expect(error.message).toMatch(/connect/i);
  });

  it("lets an aborted request through as an abort, not as a banner", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("aborted"), { name: "AbortError" }),
      );
    const client = createApiClient({
      baseUrl: BASE,
      anonKey: "anon-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.requestToken(CREDENTIALS)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("never echoes the PIN into an error message", async () => {
    const { client } = clientReturning(jsonResponse({ error: "Nope." }, 401));

    const error = (await client
      .requestToken({ pin: "super-secret-pin", deviceId: "d" })
      .catch((caught: unknown) => caught)) as ApiError;

    expect(error.message).not.toContain("super-secret-pin");
  });
});

describe("a misconfigured deployment", () => {
  // This is the first error anyone hits on a fresh checkout, so it must not
  // send a staff member to go and look at the wifi router.
  it("reports a missing anon key as a setup fault, not as a network fault", async () => {
    const fetchImpl = vi.fn();
    const client = createApiClient({
      baseUrl: BASE,
      anonKey: undefined,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const error = (await client
      .requestToken(CREDENTIALS)
      .catch((caught: unknown) => caught)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe("unavailable");
    expect(error.message).toMatch(/not set up|installed/i);
    expect(error.message).not.toMatch(/wifi/i);
    // Nothing should have been sent: there was nothing to send it with.
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("base url handling", () => {
  it("strips a trailing slash so the path never doubles up", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ token: "t", expiresIn: 1, keyterms: [] }),
      );
    const client = createApiClient({
      baseUrl: "https://example.test/functions/v1/",
      anonKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.requestToken(CREDENTIALS);

    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://example.test/functions/v1/deepgram-token",
    );
  });
});
