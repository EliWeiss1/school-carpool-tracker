/**
 * Short-lived Deepgram credentials.
 *
 * The permanent DEEPGRAM_API_KEY exists in exactly one place: the Edge Function
 * environment. The browser gets a temporary token minted here, so a key pulled
 * out of a devtools network tab expires within minutes and cannot be used to run
 * up a bill or read anything.
 *
 * `fetch` is injected rather than reached for so the tests can prove the request
 * shape without ever calling Deepgram, and so a `mock: true` deployment can run
 * the whole announce flow on no credits at all.
 */

/** Deepgram's temporary-token endpoint. */
export const DEEPGRAM_GRANT_URL = "https://api.deepgram.com/v1/auth/grant";

/** The obviously-fake token mock mode hands out. */
export const MOCK_TOKEN = "mock-deepgram-token";

/** Long enough for one pickup session, short enough that a leak expires fast. */
const DEFAULT_TTL_SECONDS = 300;
const MIN_TTL_SECONDS = 30;
/** Deepgram's own ceiling for a granted token. */
const MAX_TTL_SECONDS = 3600;

export interface DeepgramToken {
  /** The temporary token. Safe to send to the browser. */
  token: string;
  /** Seconds until it stops working. */
  expiresIn: number;
}

export interface MintTokenOptions {
  apiKey: string | undefined;
  ttlSeconds?: number;
  /** When true, no network call happens and a canned token is returned. */
  mock?: boolean;
  fetchImpl?: typeof fetch;
}

function clampTtl(ttlSeconds: number | undefined): number {
  const requested = ttlSeconds ?? DEFAULT_TTL_SECONDS;
  return Math.min(Math.max(requested, MIN_TTL_SECONDS), MAX_TTL_SECONDS);
}

/**
 * Ask Deepgram for a temporary token.
 *
 * Throws with a message safe to show a staff member -- no key material, no
 * vendor internals -- because the announce page renders it on screen.
 */
export async function mintDeepgramToken(
  options: MintTokenOptions,
): Promise<DeepgramToken> {
  const ttl = clampTtl(options.ttlSeconds);

  if (options.mock) {
    return { token: MOCK_TOKEN, expiresIn: ttl };
  }

  if (!options.apiKey) {
    throw new Error(
      "Speech recognition is not configured on the server (no Deepgram key). Use the typed search instead.",
    );
  }

  const request = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await request(DEEPGRAM_GRANT_URL, {
      method: "POST",
      headers: {
        authorization: `Token ${options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ttl_seconds: ttl }),
    });
  } catch {
    // Deliberately swallowing the cause: a fetch error can carry the request,
    // and the request carries the permanent key.
    throw new Error(
      "Could not reach the speech service. Use the typed search instead.",
    );
  }

  if (!response.ok) {
    throw new Error(
      `The speech service refused the request (${response.status}). Use the typed search instead.`,
    );
  }

  const payload: unknown = await response.json().catch(() => null);
  const token = readToken(payload);

  if (token === null) {
    throw new Error(
      "The speech service returned no token. Use the typed search instead.",
    );
  }

  return token;
}

/** Narrow the vendor's JSON without trusting its shape. */
function readToken(payload: unknown): DeepgramToken | null {
  if (typeof payload !== "object" || payload === null) return null;

  const record = payload as Record<string, unknown>;
  const token = record.access_token;
  const expiresIn = record.expires_in;

  if (typeof token !== "string" || token === "") return null;

  return {
    token,
    expiresIn: typeof expiresIn === "number" ? expiresIn : DEFAULT_TTL_SECONDS,
  };
}
