/**
 * POST /deepgram-token — mint a short-lived Deepgram token for one session.
 *
 * Also returns the keyterm list, because the browser needs both to open a
 * socket and there is no reason to make it ask twice.
 */

import type { DeepgramToken } from "../deepgram.ts";
import {
  errorResponse,
  jsonResponse,
  preflight,
  withStoreErrors,
} from "../http.ts";
import { buildKeyterms } from "../keyterms.ts";
import type { RosterStore } from "../ports.ts";
import type { VoiceClaim, VoiceUsageStore } from "../usage-ports.ts";
import { type GuardDeps, guardRequest } from "./guard.ts";
import { rosterFilterFrom } from "./filter.ts";

export interface TokenHandlerDeps extends GuardDeps {
  stores: {
    forSchool(schoolId: string): Pick<RosterStore, "list" | "listCarpools">;
  };
  /** Meters paid voice sessions per school per month. */
  usage: VoiceUsageStore;
  /** Closes over the permanent key and mock flag; see deepgram.ts. */
  mintToken: () => Promise<DeepgramToken>;
}

/** What staff are told when a claim is refused; both end by pointing at typing. */
const REFUSED_MESSAGE: Record<"disabled" | "limit", string> = {
  limit:
    "Voice is used up for this month. Type the name instead; the office can raise the limit.",
  disabled: "Voice is turned off for this school. Type the name instead.",
};

export function createTokenHandler(deps: TokenHandlerDeps) {
  return async function handle(request: Request): Promise<Response> {
    const options = preflight(request);
    if (options) return options;

    const guard = await guardRequest(request, deps, "announce");
    if (!guard.ok) return guard.response;
    const store = deps.stores.forSchool(guard.schoolId);

    return await withStoreErrors(async () => {
      const [roster, carpools] = await Promise.all([
        store.list(rosterFilterFrom(guard.body)),
        store.listCarpools(),
      ]);
      const keyterms = buildKeyterms(roster, carpools);

      // Every minted token is a paid session, so it is counted first. Mock
      // speech is counted too, which keeps the cap testable end to end. The
      // claim sits after the roster reads so a failed read does not spend one.
      let claim: VoiceClaim;
      try {
        claim = await deps.usage.claimVoiceSession(guard.schoolId);
      } catch (error: unknown) {
        // Fail closed: a counter that cannot be reached must not become
        // unlimited paid sessions. Detail goes to the log, not to staff.
        console.error("could not claim a voice session", error);
        return errorResponse(
          503,
          "Voice could not be checked right now. Type the name instead.",
        );
      }
      if (!claim.allowed) {
        // 409, never 401 or 403. Those two mean "your sign-in is no good", and
        // the screens act on that: the office is signed out, a phone goes back
        // to the code prompt. Nothing is wrong with the caller here; voice is
        // simply not available, and typing a name still works.
        return errorResponse(409, REFUSED_MESSAGE[claim.reason]);
      }

      let token: DeepgramToken;
      try {
        token = await deps.mintToken();
      } catch (error: unknown) {
        // A speech outage is not a server fault, and it has its own remedy:
        // mintDeepgramToken's messages already tell staff to type the name
        // instead, and are guaranteed to carry no key material.
        const message =
          error instanceof Error
            ? error.message
            : "Speech recognition is unavailable. Use the typed search instead.";
        return errorResponse(502, message);
      }

      return jsonResponse({
        token: token.token,
        expiresIn: token.expiresIn,
        keyterms,
      });
    });
  };
}
