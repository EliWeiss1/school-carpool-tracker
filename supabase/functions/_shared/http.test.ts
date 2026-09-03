import { describe, expect, it } from "vitest";

import {
  CORS_HEADERS,
  errorResponse,
  jsonResponse,
  preflight,
  readJsonBody,
} from "./http.ts";

describe("jsonResponse", () => {
  it("sends JSON with the CORS headers a browser needs", async () => {
    const response = jsonResponse({ ok: true });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("access-control-allow-origin")).toBe(
      CORS_HEADERS["access-control-allow-origin"],
    );
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("takes a status and extra headers", () => {
    const response = jsonResponse({ ok: true }, 201, { "retry-after": "30" });

    expect(response.status).toBe(201);
    expect(response.headers.get("retry-after")).toBe("30");
  });
});

describe("errorResponse", () => {
  it("puts a readable sentence where the UI can show it", async () => {
    const response = errorResponse(401, "That PIN was not recognised.");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "That PIN was not recognised.",
    });
  });
});

describe("preflight", () => {
  it("answers an OPTIONS request", () => {
    const response = preflight(
      new Request("https://example.test", { method: "OPTIONS" }),
    );

    expect(response?.status).toBe(204);
    expect(response?.headers.get("access-control-allow-headers")).toContain(
      "authorization",
    );
  });

  it("leaves any other method alone", () => {
    expect(
      preflight(new Request("https://example.test", { method: "POST" })),
    ).toBeNull();
  });
});

describe("readJsonBody", () => {
  it("reads a JSON object", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      body: '{"pin":"1234"}',
    });

    await expect(readJsonBody(request)).resolves.toEqual({ pin: "1234" });
  });

  it("treats unreadable or non-object bodies as empty rather than throwing", async () => {
    const broken = new Request("https://example.test", {
      method: "POST",
      body: "not json",
    });
    const array = new Request("https://example.test", {
      method: "POST",
      body: "[1,2]",
    });

    await expect(readJsonBody(broken)).resolves.toEqual({});
    await expect(readJsonBody(array)).resolves.toEqual({});
  });
});
