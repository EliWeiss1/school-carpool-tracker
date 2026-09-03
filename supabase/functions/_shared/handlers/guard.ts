/**
 * The checks every write-capable endpoint runs before it does anything.
 *
 * Order is deliberate: method, then rate limit, then PIN. Counting before
 * checking means a device guessing PINs runs out of attempts, which is the only
 * attack this app really has. It costs a legitimate device nothing, because a
 * legitimate device is not sending wrong PINs.
 */

import { errorResponse, readJsonBody, readString } from "../http.ts";
import { verifyPin } from "../pin.ts";
import type { RateLimiter } from "../rate-limit.ts";

export interface GuardDeps {
  /** From the STAFF_PIN env var. Undefined rejects everything. */
  staffPin: string | undefined;
  /** Spam control, keyed on the self-reported device id. */
  rateLimiter: RateLimiter;
  /**
   * The PIN guessing budget, keyed on client IP. Required, not optional: an
   * endpoint that forgot to pass one would hand out unlimited PIN attempts.
   */
  pinAttemptLimiter: RateLimiter;
}

export type GuardResult =
  | { ok: true; body: Record<string, unknown>; deviceId: string }
  | { ok: false; response: Response };

/**
 * The device id is self-reported and trivially forgeable. That is fine: it
 * separates one honest phone's spam from another's, and the PIN is what actually
 * protects the roster.
 */
function deviceIdOf(request: Request, body: Record<string, unknown>): string {
  return (
    readString(body, "deviceId") ??
    request.headers.get("x-device-id") ??
    "anonymous"
  );
}

/**
 * The caller's address, as observed by the proxy in front of this function.
 *
 * The last hop is the one to trust: a client can put anything at the front of
 * X-Forwarded-For, but the edge appends what it actually saw. Requests with no
 * header at all share one bucket, so stripping it buys nothing.
 */
function clientIpOf(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded) return "unknown";

  const hops = forwarded
    .split(",")
    .map((hop) => hop.trim())
    .filter((hop) => hop !== "");

  return hops[hops.length - 1] ?? "unknown";
}

export async function guardRequest(
  request: Request,
  deps: GuardDeps,
): Promise<GuardResult> {
  if (request.method !== "POST") {
    return {
      ok: false,
      response: errorResponse(405, "This endpoint only accepts POST."),
    };
  }

  const body = await readJsonBody(request);
  const deviceId = deviceIdOf(request, body);

  const limit = deps.rateLimiter.check(deviceId);
  if (!limit.allowed) {
    return {
      ok: false,
      response: errorResponse(
        429,
        "This device has sent too many requests. Wait a moment and try again.",
        { "retry-after": String(limit.retryAfterSeconds) },
      ),
    };
  }

  // A blank STAFF_PIN is a deployment fault, not a failed login. It still
  // rejects the request -- verifyPin fails closed -- but a school with no other
  // console needs to be able to tell the two apart.
  if ((deps.staffPin ?? "").trim() === "") {
    return {
      ok: false,
      response: errorResponse(
        503,
        "The staff PIN is not set up on the server. Ask whoever installed the app.",
      ),
    };
  }

  // The device limiter above cannot protect the PIN: deviceId comes out of the
  // request body, so a guesser just sends a new one each time. The guessing
  // budget is therefore keyed on the client address and spends only on failure,
  // which costs staff who type their PIN correctly exactly nothing.
  const clientIp = clientIpOf(request);
  const guesses = deps.pinAttemptLimiter.peek(clientIp);
  if (!guesses.allowed) {
    return {
      ok: false,
      response: errorResponse(
        429,
        "Too many incorrect PINs from this network. Wait a few minutes and try again.",
        { "retry-after": String(guesses.retryAfterSeconds) },
      ),
    };
  }

  const pinIsValid = await verifyPin(readString(body, "pin"), deps.staffPin);
  if (!pinIsValid) {
    deps.pinAttemptLimiter.check(clientIp);
    return {
      ok: false,
      response: errorResponse(
        401,
        "That PIN was not recognised. Check with the office.",
      ),
    };
  }

  return { ok: true, body, deviceId };
}
