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
import { type GuardDeps, guardRequest } from "./guard.ts";
import { rosterFilterFrom } from "./filter.ts";

export interface TokenHandlerDeps extends GuardDeps {
  store: Pick<RosterStore, "list" | "listCarpools">;
  /** Closes over the permanent key and mock flag; see deepgram.ts. */
  mintToken: () => Promise<DeepgramToken>;
}

export function createTokenHandler(deps: TokenHandlerDeps) {
  return async function handle(request: Request): Promise<Response> {
    const options = preflight(request);
    if (options) return options;

    const guard = await guardRequest(request, deps);
    if (!guard.ok) return guard.response;

    return await withStoreErrors(async () => {
      const [roster, carpools] = await Promise.all([
        deps.store.list(rosterFilterFrom(guard.body)),
        deps.store.listCarpools(),
      ]);
      const keyterms = buildKeyterms(roster, carpools);

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
