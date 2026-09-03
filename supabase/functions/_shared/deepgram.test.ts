import { describe, expect, it, vi } from "vitest";

import {
  DEEPGRAM_GRANT_URL,
  MOCK_TOKEN,
  mintDeepgramToken,
} from "./deepgram.ts";

/** A fetch that records its call and returns a canned Deepgram grant. */
function fakeFetch(response: { status?: number; body?: unknown } = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify(
          response.body ?? { access_token: "dg_temp", expires_in: 300 },
        ),
        {
          status: response.status ?? 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  );
  return { impl: impl as unknown as typeof fetch, calls };
}

const PERMANENT_KEY = "permanent-deepgram-key";

describe("mintDeepgramToken", () => {
  it("asks Deepgram to grant a short-lived token", async () => {
    const fetcher = fakeFetch();

    await mintDeepgramToken({
      apiKey: PERMANENT_KEY,
      ttlSeconds: 120,
      fetchImpl: fetcher.impl,
    });

    const [call] = fetcher.calls;
    expect(call.url).toBe(DEEPGRAM_GRANT_URL);
    expect(call.init.method).toBe("POST");
    expect(JSON.parse(String(call.init.body))).toEqual({ ttl_seconds: 120 });
  });

  it("authenticates with the permanent key but returns only the temporary one", async () => {
    const fetcher = fakeFetch();

    const token = await mintDeepgramToken({
      apiKey: PERMANENT_KEY,
      fetchImpl: fetcher.impl,
    });

    const headers = new Headers(fetcher.calls[0].init.headers);
    expect(headers.get("authorization")).toBe(`Token ${PERMANENT_KEY}`);
    expect(token).toEqual({ token: "dg_temp", expiresIn: 300 });
    expect(JSON.stringify(token)).not.toContain(PERMANENT_KEY);
  });

  it("keeps the lifetime short even when asked for a long one", () => {
    // A leaked token is only as dangerous as the time it stays valid.
    const fetcher = fakeFetch();

    return mintDeepgramToken({
      apiKey: PERMANENT_KEY,
      ttlSeconds: 86_400,
      fetchImpl: fetcher.impl,
    }).then(() => {
      expect(JSON.parse(String(fetcher.calls[0].init.body)).ttl_seconds).toBe(
        3600,
      );
    });
  });

  it("returns a canned token in mock mode without calling Deepgram", async () => {
    const fetcher = fakeFetch();

    const token = await mintDeepgramToken({
      apiKey: PERMANENT_KEY,
      mock: true,
      fetchImpl: fetcher.impl,
    });

    expect(token.token).toBe(MOCK_TOKEN);
    expect(fetcher.calls).toHaveLength(0);
  });

  it("works in mock mode with no key configured at all", async () => {
    await expect(
      mintDeepgramToken({ apiKey: undefined, mock: true }),
    ).resolves.toMatchObject({
      token: MOCK_TOKEN,
    });
  });

  it("refuses to run without a key when not mocking", async () => {
    await expect(mintDeepgramToken({ apiKey: undefined })).rejects.toThrow(
      /not configured/i,
    );
  });

  it("explains a rejected key in words a staff member could relay", async () => {
    const fetcher = fakeFetch({
      status: 401,
      body: { err_msg: "invalid credentials" },
    });

    await expect(
      mintDeepgramToken({ apiKey: PERMANENT_KEY, fetchImpl: fetcher.impl }),
    ).rejects.toThrow(/speech service/i);
  });

  it("does not put the permanent key into its error message", async () => {
    const fetcher = fakeFetch({ status: 500 });

    const error = await mintDeepgramToken({
      apiKey: PERMANENT_KEY,
      fetchImpl: fetcher.impl,
    }).catch((thrown: unknown) => thrown as Error);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(PERMANENT_KEY);
  });

  it("treats a response with no token as a failure", async () => {
    const fetcher = fakeFetch({ body: { expires_in: 300 } });

    await expect(
      mintDeepgramToken({ apiKey: PERMANENT_KEY, fetchImpl: fetcher.impl }),
    ).rejects.toThrow(/speech service/i);
  });
});
