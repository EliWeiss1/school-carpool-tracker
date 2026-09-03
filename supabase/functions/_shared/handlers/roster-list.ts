/**
 * POST /roster-list — the full roster for /admin, every status included.
 *
 * Separate from /resolve-name on purpose: that endpoint returns just enough of
 * a student to render a tap target and exists to be called with no operator
 * watching, mid-pickup. This one is for the office screen, so it returns the
 * whole row -- aliases included -- and is guarded the same way every other
 * write-adjacent endpoint is, even though it only reads.
 */

import {
  jsonResponse,
  preflight,
  withStoreErrors,
} from "../http.ts";
import type { RosterStore } from "../ports.ts";
import { rosterFilterFrom } from "./filter.ts";
import { type GuardDeps, guardRequest } from "./guard.ts";

export interface RosterListHandlerDeps extends GuardDeps {
  store: Pick<RosterStore, "list">;
}

export function createRosterListHandler(deps: RosterListHandlerDeps) {
  return async function handle(request: Request): Promise<Response> {
    const options = preflight(request);
    if (options) return options;

    const guard = await guardRequest(request, deps);
    if (!guard.ok) return guard.response;

    return await withStoreErrors(async () => {
      const students = await deps.store.list(rosterFilterFrom(guard.body));
      return jsonResponse({ students });
    });
  };
}
