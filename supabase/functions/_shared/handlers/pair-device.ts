/**
 * POST /pair-device — connect a phone or a wall board to a school with a code.
 *
 * The caller is a device with no account: it signed in anonymously, and this is
 * the one place that session gains access to anything. The office set two short
 * codes (announce, display; they may be equal) and a device proves it holds one.
 *
 * The code is a short secret typed by hand, so guessing it must be slow, and
 * must learn nothing:
 *
 * - The per-IP budget is *charged up front* and handed back (`forgive`) only
 *   when the code turns out to be right. Checking first and charging after the
 *   slow part would let a burst of parallel guesses all slip in under the limit.
 * - Everything else -- finding the school, the school's and the address's
 *   lockouts, comparing the code, counting a failure, recording the device --
 *   is one atomic database step (`attemptPairing`). It runs under a row lock on
 *   the school, so parallel guesses are counted one at a time, and a device
 *   cannot be paired with a code the office has just replaced.
 * - Every way of failing (unknown school, malformed slug or code, wrong code)
 *   is the same 403 with the same words, and the budget stays spent.
 *
 * The staff PIN has no way in here: this uses `authenticateRequest` only.
 */

import { isValidDeviceCode, normalizeDeviceCode } from "../device-code.ts";
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
  schools: Pick<SchoolStore, "attemptPairing">;
  /**
   * Wrong-code budget, keyed on client IP. Charged on every attempt and handed
   * back on success. Required: an endpoint that forgot it would allow
   * unlimited guessing.
   */
  codeAttemptLimiter: RateLimiter;
  /** Injectable clock (ms), for the retry-after of a locked answer. */
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
    const budget = deps.codeAttemptLimiter.check(clientIp);
    if (!budget.allowed) {
      return errorResponse(
        429,
        "Too many wrong codes from this network. Wait a few minutes and try again.",
        { "retry-after": String(budget.retryAfterSeconds) },
      );
    }

    const slug = readSlug(auth.body.schoolSlug);
    const rawCode = readString(auth.body, "code");
    if (!slug.ok || rawCode === null || !isValidDeviceCode(rawCode)) {
      return errorResponse(403, NOT_RECOGNISED);
    }

    return await withStoreErrors(async () => {
      const outcome = await deps.schools.attemptPairing({
        schoolSlug: slug.value,
        code: normalizeDeviceCode(rawCode),
        userId: auth.user.userId,
        label: label.value,
        clientIp,
      });

      if (outcome.status === "refused") {
        return errorResponse(403, NOT_RECOGNISED);
      }

      if (outcome.status === "locked") {
        const waitMs = Date.parse(outcome.lockedUntil) - now();
        return errorResponse(
          429,
          "Too many wrong codes for this school. Wait a few minutes, or ask the office to check the code.",
          { "retry-after": String(Math.max(1, Math.ceil(waitMs / 1000))) },
        );
      }

      // Right code: this attempt was not a guess, so it costs nothing.
      deps.codeAttemptLimiter.forgive(clientIp);
      return jsonResponse({
        school: outcome.school,
        canAnnounce: outcome.canAnnounce,
        canDisplay: outcome.canDisplay,
      });
    });
  };
}
