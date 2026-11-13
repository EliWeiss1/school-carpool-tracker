/**
 * POST /pair-device — connect a phone or a wall board to a school with a code.
 *
 * The caller is a device with no account: it signed in anonymously, and this is
 * the one place that session gains access to anything. The office set two short
 * codes (announce, display; they may be equal) and a device proves it holds one.
 *
 * The code is a short secret typed by hand, so everything here is built so that
 * guessing it is slow and learns nothing:
 *
 * - Every way of failing (unknown school, malformed slug or code, wrong code)
 *   is the same 403 with the same words, and every one spends the caller's
 *   per-IP budget. An unknown school still runs a comparison, so the response
 *   time does not separate "no such school" from "wrong code".
 * - Wrong codes are also counted per school in the database, and ten in ten
 *   minutes lock that school's *new pairings* for fifteen. A lockout never
 *   touches a device that is already connected.
 *
 * The staff PIN has no way in here: this uses `authenticateRequest` only.
 */

import { deviceCodeMatches, isValidDeviceCode } from "../device-code.ts";
import {
  errorResponse,
  jsonResponse,
  preflight,
  readString,
  withStoreErrors,
} from "../http.ts";
import type { RateLimiter } from "../rate-limit.ts";
import { readDeviceLabel, readSlug } from "../school-input.ts";
import type { SchoolStore } from "../school-ports.ts";
import { type AuthDeps, authenticateRequest, clientIpOf } from "./guard.ts";

export interface PairDeviceHandlerDeps extends AuthDeps {
  schools: Pick<
    SchoolStore,
    "findSchoolForPairing" | "notePairFailure" | "pairDevice"
  >;
  /**
   * Wrong-code budget, keyed on client IP and spent only on a wrong code.
   * Required: an endpoint that forgot it would allow unlimited guessing.
   */
  codeAttemptLimiter: RateLimiter;
  /** Injectable clock (ms) for the lockout comparison. */
  now?: () => number;
}

const NOT_RECOGNISED = "That code was not recognised. Check with the office.";

export function createPairDeviceHandler(deps: PairDeviceHandlerDeps) {
  const now = deps.now ?? (() => Date.now());

  return async function handle(request: Request): Promise<Response> {
    const options = preflight(request);
    if (options) return options;

    const auth = await authenticateRequest(request, deps);
    if (!auth.ok) return auth.response;

    // An office login must not be turned into a device: the two sessions live
    // under separate storage keys on purpose (see the design doc).
    if (!auth.user.isAnonymous) {
      return errorResponse(
        403,
        "Open the school's link on the phone or screen itself to connect it.",
      );
    }

    const label = readDeviceLabel(auth.body.label);
    if (!label.ok) return errorResponse(400, label.error);

    const clientIp = clientIpOf(request);
    const budget = deps.codeAttemptLimiter.peek(clientIp);
    if (!budget.allowed) {
      return errorResponse(
        429,
        "Too many wrong codes from this network. Wait a few minutes and try again.",
        { "retry-after": String(budget.retryAfterSeconds) },
      );
    }

    const refuse = () => {
      deps.codeAttemptLimiter.check(clientIp);
      return errorResponse(403, NOT_RECOGNISED);
    };

    const slug = readSlug(auth.body.schoolSlug);
    const rawCode = readString(auth.body, "code");
    const codeIsUsable = rawCode !== null && isValidDeviceCode(rawCode);
    const code = codeIsUsable ? rawCode : "";

    return await withStoreErrors(async () => {
      const school = slug.ok
        ? await deps.schools.findSchoolForPairing(slug.value)
        : null;

      if (!school || !codeIsUsable) {
        // Same work as a real comparison, so timing does not tell the cases apart.
        await deviceCodeMatches(code, null);
        return refuse();
      }

      const lockedUntil =
        school.lockedUntil === null ? NaN : Date.parse(school.lockedUntil);
      if (lockedUntil > now()) {
        return errorResponse(
          429,
          "Too many wrong codes for this school. Wait a few minutes, or ask the office to check the code.",
          {
            "retry-after": String(Math.ceil((lockedUntil - now()) / 1000)),
          },
        );
      }

      // Both comparisons always run, so a code that matches the first does not
      // return faster than one that matches neither.
      const [isAnnounce, isDisplay] = await Promise.all([
        deviceCodeMatches(code, school.announceCode),
        deviceCodeMatches(code, school.displayCode),
      ]);

      if (!isAnnounce && !isDisplay) {
        await deps.schools.notePairFailure(school.id);
        return refuse();
      }

      await deps.schools.pairDevice({
        schoolId: school.id,
        userId: auth.user.userId,
        canAnnounce: isAnnounce,
        canDisplay: isDisplay,
        label: label.value,
      });

      return jsonResponse({
        school: { id: school.id, name: school.name, slug: school.slug },
        canAnnounce: isAnnounce,
        canDisplay: isDisplay,
      });
    });
  };
}
