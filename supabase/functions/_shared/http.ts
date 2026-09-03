/**
 * The small HTTP shapes every Edge Function in this project shares.
 *
 * Errors are a single readable sentence under `error`, not a code the announce
 * page would have to translate: whoever is standing outside in the rain needs to
 * know what to do next, and the only useful instruction is usually "use the
 * typed search instead".
 */

/**
 * Any origin may call these functions. The origin is not the security boundary
 * here -- the staff PIN is -- and pinning an allow-list would break the moment
 * the app moves between a Vercel preview URL and its real domain.
 */
export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

/** `message` is rendered verbatim on screen, so write it for a staff member. */
export function errorResponse(
  status: number,
  message: string,
  headers: Record<string, string> = {},
): Response {
  return jsonResponse({ error: message }, status, headers);
}

/** Answers a CORS preflight, or returns null when this is a real request. */
export function preflight(request: Request): Response | null {
  if (request.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Parse a JSON object body. A malformed body is indistinguishable from a missing
 * one for our purposes: both fail the field checks that follow, with a message
 * about the missing field rather than about JSON syntax.
 */
export async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Turn a store failure into an answer the announce page can actually show.
 *
 * Without this the rejection escapes to `Deno.serve`, which replies 500 with no
 * CORS headers -- so the browser reports a CORS error and the person standing
 * outside sees nothing that tells them what to do.
 */
export async function withStoreErrors(
  work: () => Promise<Response>,
): Promise<Response> {
  try {
    return await work();
  } catch (error: unknown) {
    console.error("edge function failed", error);
    const message =
      error instanceof Error && error.message !== ""
        ? error.message
        : "Something went wrong on the server.";
    return errorResponse(503, `${message} Try again in a moment.`);
  }
}

/** Read a required non-empty string field. */
export function readString(
  body: Record<string, unknown>,
  field: string,
): string | null {
  const value = body[field];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
