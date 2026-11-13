/**
 * The checks every endpoint runs before it does anything: who is calling, which
 * school they mean, and whether they may do this there.
 *
 * Two ways in, for the length of the rollout:
 *
 * 1. **A Supabase session.** `Authorization: Bearer <access token>` plus
 *    `schoolId` in the body. The token says who; the tenancy tables say what
 *    they are to that school; the endpoint's capability says whether that is
 *    enough. This is the only way in for every school but the first.
 * 2. **The shared staff PIN** (`pin` in the body), exactly as before schools
 *    existed. It always means the legacy school, whatever else the body says,
 *    and it disappears at cutover.
 *
 * The school id a handler receives comes out of this file and nowhere else. A
 * handler never reads `schoolId` from the body itself: the body is what the
 * caller *claims*, and `GuardResult.schoolId` is what was checked.
 */

import type {
  AccessStore,
  Caller,
  Capability,
  SchoolAccess,
  VerifiedUser,
} from "../access-ports.ts";
import { errorResponse, readJsonBody, readString } from "../http.ts";
import { verifyPin } from "../pin.ts";
import type { RateLimiter } from "../rate-limit.ts";
import { isUuid, LEGACY_SCHOOL_ID } from "../schools.ts";

/** What it takes to know who is calling. */
export interface AuthDeps {
  /** Spam control, keyed on the self-reported device id. */
  rateLimiter: RateLimiter;
  /** Verifies tokens and looks up what a user is to a school. */
  access: AccessStore;
}

export interface GuardDeps extends AuthDeps {
  /** From the STAFF_PIN env var. Undefined rejects every PIN request. */
  staffPin: string | undefined;
  /**
   * The PIN guessing budget, keyed on client IP. Required, not optional: an
   * endpoint that forgot to pass one would hand out unlimited PIN attempts.
   */
  pinAttemptLimiter: RateLimiter;
}

type Refused = { ok: false; response: Response };

export type GuardResult =
  | {
      ok: true;
      body: Record<string, unknown>;
      deviceId: string;
      /** The school this request was authorised for. Checked, not claimed. */
      schoolId: string;
      caller: Caller;
    }
  | Refused;

export type AuthResult =
  | {
      ok: true;
      body: Record<string, unknown>;
      deviceId: string;
      user: VerifiedUser;
    }
  | Refused;

function refuse(
  status: number,
  message: string,
  headers?: Record<string, string>,
): Refused {
  return { ok: false, response: errorResponse(status, message, headers) };
}

/**
 * The device id is self-reported and trivially forgeable. That is fine: it
 * separates one honest phone's spam from another's, and it is never what
 * protects a roster.
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
export function clientIpOf(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded) return "unknown";

  const hops = forwarded
    .split(",")
    .map((hop) => hop.trim())
    .filter((hop) => hop !== "");

  return hops[hops.length - 1] ?? "unknown";
}

/** The token from `Authorization: Bearer <token>`, or null. */
function bearerTokenOf(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

type Opened =
  { ok: true; body: Record<string, unknown>; deviceId: string } | Refused;

/** Method, body, and the spam limiter: the part every request shares. */
async function openRequest(
  request: Request,
  rateLimiter: RateLimiter,
): Promise<Opened> {
  if (request.method !== "POST") {
    return refuse(405, "This endpoint only accepts POST.");
  }

  const body = await readJsonBody(request);
  const deviceId = deviceIdOf(request, body);

  const limit = rateLimiter.check(deviceId);
  if (!limit.allowed) {
    return refuse(
      429,
      "This device has sent too many requests. Wait a moment and try again.",
      { "retry-after": String(limit.retryAfterSeconds) },
    );
  }

  return { ok: true, body, deviceId };
}

/** Turns the request's bearer token into a user, or the reason it could not. */
async function verifiedUserOf(
  request: Request,
  access: AccessStore,
): Promise<{ ok: true; user: VerifiedUser } | Refused> {
  const token = bearerTokenOf(request);
  if (!token) {
    return refuse(
      401,
      "Your sign-in has ended. Sign in, or enter the school's code again.",
    );
  }

  let user: VerifiedUser | null;
  try {
    user = await access.verifyToken(token);
  } catch {
    return refuse(
      503,
      "The sign-in service could not be reached. Try again in a moment.",
    );
  }

  // Covers garbage, an expired session, a disconnected device, and the
  // project's public key, which is a valid JWT but not a person.
  if (!user) {
    return refuse(
      401,
      "Your sign-in has ended. Sign in, or enter the school's code again.",
    );
  }
  return { ok: true, user };
}

/**
 * For the few endpoints that act before any school is involved (creating a
 * school, pairing a device): proves there is a signed-in user and nothing more.
 * There is deliberately no staff-PIN way through here.
 */
export async function authenticateRequest(
  request: Request,
  deps: AuthDeps,
): Promise<AuthResult> {
  const opened = await openRequest(request, deps.rateLimiter);
  if (!opened.ok) return opened;

  const verified = await verifiedUserOf(request, deps.access);
  if (!verified.ok) return verified;

  return {
    ok: true,
    body: opened.body,
    deviceId: opened.deviceId,
    user: verified.user,
  };
}

/** Whether `access` is enough for an endpoint that needs `capability`. */
function satisfies(access: SchoolAccess, capability: Capability): boolean {
  if (access.kind === "member") return true;
  return capability === "announce" && access.canAnnounce;
}

/** The staff PIN, as it worked before schools existed. Rollout only. */
async function guardWithPin(
  request: Request,
  deps: GuardDeps,
  opened: { body: Record<string, unknown>; deviceId: string },
): Promise<GuardResult> {
  // A blank STAFF_PIN is a deployment fault, not a failed login. It still
  // rejects the request -- verifyPin fails closed -- but a school with no other
  // console needs to be able to tell the two apart.
  if ((deps.staffPin ?? "").trim() === "") {
    return refuse(
      503,
      "The staff PIN is not set up on the server. Ask whoever installed the app.",
    );
  }

  // The device limiter cannot protect the PIN: deviceId comes out of the
  // request body, so a guesser just sends a new one each time. The guessing
  // budget is therefore keyed on the client address and spends only on failure,
  // which costs staff who type their PIN correctly exactly nothing.
  const clientIp = clientIpOf(request);
  const guesses = deps.pinAttemptLimiter.peek(clientIp);
  if (!guesses.allowed) {
    return refuse(
      429,
      "Too many incorrect PINs from this network. Wait a few minutes and try again.",
      { "retry-after": String(guesses.retryAfterSeconds) },
    );
  }

  const pinIsValid = await verifyPin(
    readString(opened.body, "pin"),
    deps.staffPin,
  );
  if (!pinIsValid) {
    deps.pinAttemptLimiter.check(clientIp);
    return refuse(401, "That PIN was not recognised. Check with the office.");
  }

  return {
    ok: true,
    body: opened.body,
    deviceId: opened.deviceId,
    // Never the body's schoolId: the PIN belongs to one school, and a PIN
    // holder naming another school must not be believed.
    schoolId: LEGACY_SCHOOL_ID,
    caller: { kind: "legacy-pin" },
  };
}

/**
 * The session way in: token, school, capability. Shared by `guardRequest` and
 * `guardSessionRequest` so the two can never drift apart.
 */
async function guardWithSession(
  request: Request,
  access: AccessStore,
  opened: { body: Record<string, unknown>; deviceId: string },
  capability: Capability,
): Promise<GuardResult> {
  const verified = await verifiedUserOf(request, access);
  if (!verified.ok) return verified;
  const { user } = verified;

  const schoolId = opened.body.schoolId;
  if (!isUuid(schoolId)) {
    return refuse(
      400,
      "This page is missing its school. Reload it and try again.",
    );
  }

  let granted: SchoolAccess | null;
  try {
    granted = await access.accessFor(user.userId, schoolId);
  } catch {
    return refuse(
      503,
      "The school could not be looked up. Try again in a moment.",
    );
  }

  // A device session is never an office account, whatever a row says. Nothing
  // creates such a row; if one ever appears, it must not open the office.
  if (granted?.kind === "member" && user.isAnonymous) granted = null;

  // The same answer for "no such school" and "not your school", so a school's
  // id cannot be confirmed by probing.
  if (!granted) {
    return refuse(
      403,
      "This account or device is not connected to this school.",
    );
  }

  if (!satisfies(granted, capability)) {
    return refuse(
      403,
      capability === "office"
        ? "Sign in with the school's office account to do this."
        : "This device is connected for the board only. Ask the office for the announce code.",
    );
  }

  const caller: Caller =
    granted.kind === "member"
      ? { kind: "member", userId: user.userId, role: granted.role }
      : { kind: "device", userId: user.userId };

  return {
    ok: true,
    body: opened.body,
    deviceId: opened.deviceId,
    schoolId: schoolId.toLowerCase(),
    caller,
  };
}

/**
 * The guard for every endpoint that existed before schools did. Accepts a
 * Supabase session, or -- until cutover -- the legacy staff PIN.
 */
export async function guardRequest(
  request: Request,
  deps: GuardDeps,
  capability: Capability,
): Promise<GuardResult> {
  const opened = await openRequest(request, deps.rateLimiter);
  if (!opened.ok) return opened;

  // A request that carries a `pin` field at all is an old page talking. It is
  // judged entirely by the PIN and never falls through to the token path, so a
  // wrong PIN cannot be rescued by a token for some other school.
  if (Object.hasOwn(opened.body, "pin")) {
    return await guardWithPin(request, deps, opened);
  }

  return await guardWithSession(request, deps.access, opened, capability);
}

/**
 * The guard for endpoints born after schools: a Supabase session or nothing.
 * It takes no PIN and no PIN budget, so the staff PIN can never reach school
 * settings, device codes or the device list -- and adding such an endpoint
 * spends none of the shared wrong-PIN allowance (see pin-budget.test.ts).
 */
export async function guardSessionRequest(
  request: Request,
  deps: AuthDeps,
  capability: Capability,
): Promise<GuardResult> {
  const opened = await openRequest(request, deps.rateLimiter);
  if (!opened.ok) return opened;

  return await guardWithSession(request, deps.access, opened, capability);
}
