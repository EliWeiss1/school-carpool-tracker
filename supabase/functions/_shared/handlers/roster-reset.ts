/**
 * POST /roster-reset — the morning "clear the board" action.
 *
 * The client-side confirmation step lives in /admin, not here: this endpoint
 * does the reset the moment it is called, guarded the same way as every other
 * write (rate limit, then PIN). What it guarantees on its own is the part a
 * confirmation dialog cannot: that the operation is safe to click twice, and
 * that it never fabricates history for a child nothing happened to.
 *
 * `store.resetAllToWaiting` only returns rows that were genuinely `arrived`,
 * so a student already `waiting` gets no audit row, no realtime event, and no
 * flash on /display -- a bulk reset of a mostly-empty board does nothing.
 */

import { jsonResponse, preflight, withStoreErrors } from "../http.ts";
import type { RosterStore } from "../ports.ts";
import { type GuardDeps, guardRequest } from "./guard.ts";

export interface RosterResetHandlerDeps extends GuardDeps {
  store: Pick<RosterStore, "resetAllToWaiting" | "logEvent">;
}

export function createRosterResetHandler(deps: RosterResetHandlerDeps) {
  return async function handle(request: Request): Promise<Response> {
    const options = preflight(request);
    if (options) return options;

    const guard = await guardRequest(request, deps);
    if (!guard.ok) return guard.response;

    return await withStoreErrors(async () => {
      const changed = await deps.store.resetAllToWaiting();

      // One audit row per child actually moved. A failed row here must not
      // undo the reset the display has already shown -- the same rule
      // /set-status follows -- so this only counts failures, never retries
      // the whole reset over it.
      let logged = 0;
      for (const student of changed) {
        const ok = await deps.store.logEvent({
          studentId: student.id,
          changedTo: "waiting",
          source: "admin",
          matchConfidence: null,
          rawTranscript: null,
          carpoolId: null,
        });
        if (ok) logged++;
      }

      return jsonResponse({ reset: changed.length, logged });
    });
  };
}
