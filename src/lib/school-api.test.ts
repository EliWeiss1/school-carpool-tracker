import { describe, expect, it, vi } from "vitest";

import { ApiError } from "./api";
import { createSchoolApiClient } from "./school-api";

const BASE = "https://example.test/functions/v1";
const AUTH = { accessToken: "user-jwt", deviceId: "device-a" };

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
  for (const response of responses) fetchImpl.mockResolvedValueOnce(response);
  const client = createSchoolApiClient({
    baseUrl: BASE,
    anonKey: "anon-key",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return { client, fetchImpl };
}

function requestAt(fetchImpl: ReturnType<typeof vi.fn>, index = 0) {
  const [url, init] = fetchImpl.mock.calls[index] as [string, RequestInit];
  return {
    url,
    body: JSON.parse(String(init.body)) as Record<string, unknown>,
    headers: init.headers as Record<string, string>,
  };
}

describe("school-write", () => {
  it("create sends the user's token as Bearer, never a pin, never the token in the body", async () => {
    const { client, fetchImpl } = clientReturning(
      jsonResponse({
        school: { id: "s", name: "Maple", slug: "maple", timezone: "UTC" },
        created: true,
      }),
    );

    const result = await client.createSchool({
      ...AUTH,
      name: "Maple",
      slug: "maple",
      timezone: "UTC",
    });
    const sent = requestAt(fetchImpl);

    expect(result.created).toBe(true);
    expect(sent.url).toBe(BASE + "/school-write");
    expect(sent.headers.authorization).toBe("Bearer user-jwt");
    expect(sent.headers.apikey).toBe("anon-key");
    expect(sent.body).toEqual({
      action: "create",
      name: "Maple",
      slug: "maple",
      timezone: "UTC",
      deviceId: "device-a",
    });
  });

  it("surfaces the server's sentence on a taken address as a conflict", async () => {
    const { client } = clientReturning(
      jsonResponse({ error: "That web address is taken." }, 409),
    );
    await expect(
      client.createSchool({
        ...AUTH,
        name: "M",
        slug: "maple",
        timezone: "UTC",
      }),
    ).rejects.toMatchObject({
      kind: "conflict",
      status: 409,
      message: "That web address is taken.",
    });
  });

  it("update-settings sends only the fields given", async () => {
    const { client, fetchImpl } = clientReturning(jsonResponse({ school: {} }));
    await client.updateSettings({
      ...AUTH,
      schoolId: "s1",
      resetHour: 19,
      resetDays: [0, 1],
    });
    expect(requestAt(fetchImpl).body).toEqual({
      action: "update-settings",
      schoolId: "s1",
      deviceId: "device-a",
      resetHour: 19,
      resetDays: [0, 1],
    });
  });

  it("get-codes, set-code, list-devices and disconnect-device use their action names", async () => {
    const { client, fetchImpl } = clientReturning(
      jsonResponse({ announceCode: null, displayCode: null }),
      jsonResponse({ announceCode: "a", displayCode: "b", disconnected: 2 }),
      jsonResponse({ devices: [] }),
      jsonResponse({ disconnected: true }),
    );
    await client.getCodes({ ...AUTH, schoolId: "s1" });
    await client.setCode({
      ...AUTH,
      schoolId: "s1",
      which: "both",
      code: "maple1",
      disconnectDevices: true,
    });
    await client.listDevices({ ...AUTH, schoolId: "s1" });
    await client.disconnectDevice({
      ...AUTH,
      schoolId: "s1",
      deviceRowId: "d1",
    });

    const bodies = [0, 1, 2, 3].map((i) => requestAt(fetchImpl, i).body);
    expect(bodies.map((b) => b.action)).toEqual([
      "get-codes",
      "set-code",
      "list-devices",
      "disconnect-device",
    ]);
    expect(bodies[1]).toMatchObject({
      which: "both",
      code: "maple1",
      disconnectDevices: true,
    });
    expect(bodies[3]).toMatchObject({ deviceRowId: "d1" });
    for (const body of bodies) {
      expect(body).not.toHaveProperty("pin");
      expect(body).not.toHaveProperty("accessToken");
    }
  });
});

describe("pair-device", () => {
  it("sends the slug, code and label with the device session's token", async () => {
    const { client, fetchImpl } = clientReturning(
      jsonResponse({
        school: { id: "s", name: "Maple", slug: "maple" },
        canAnnounce: true,
        canDisplay: false,
      }),
    );
    const result = await client.pairDevice({
      ...AUTH,
      schoolSlug: "maple",
      code: "1234",
      label: "Front gate",
    });
    const sent = requestAt(fetchImpl);

    expect(result.canAnnounce).toBe(true);
    expect(sent.url).toBe(BASE + "/pair-device");
    expect(sent.headers.authorization).toBe("Bearer user-jwt");
    expect(sent.body).toEqual({
      schoolSlug: "maple",
      code: "1234",
      label: "Front gate",
      deviceId: "device-a",
    });
  });

  it("leaves an absent label off the wire", async () => {
    const { client, fetchImpl } = clientReturning(
      jsonResponse({ school: {}, canAnnounce: true, canDisplay: true }),
    );
    await client.pairDevice({ ...AUTH, schoolSlug: "m", code: "1" });
    expect(requestAt(fetchImpl).body).not.toHaveProperty("label");
  });

  it("reports a lockout with its retry-after", async () => {
    const { client } = clientReturning(
      jsonResponse({ error: "Too many tries. Wait a few minutes." }, 429, {
        "retry-after": "120",
      }),
    );
    const error = await client
      .pairDevice({ ...AUTH, schoolSlug: "m", code: "1" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: "throttled", retryAfterSeconds: 120 });
  });
});
