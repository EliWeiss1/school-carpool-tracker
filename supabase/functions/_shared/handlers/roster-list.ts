/**
 * POST /roster-list — the full roster for /admin, every status included.
 *
 * Separate from /resolve-name on purpose: that endpoint returns just enough of
 * a student to render a tap target and exists to be called with no operator
 * watching, mid-pickup. This one is for the office screen, so it returns the
 * whole row -- aliases included -- and is guarded the same way every other
 * write-adjacent endpoint is, even though it only reads.
 *
 * Also returns every carpool: /admin needs both the roster and the carpool
 * list on the same load (the carpool manager and the student form's carpool
 * picker both need it), and a second entrypoint would only cost another slice
 * of the shared PIN-guessing budget for no security benefit.
 *
 * And `classMemberCounts` (class id -> students in it), for the class manager's
 * per-class badge. It is counted over the whole school, never the filtered
 * view, so narrowing the roster table does not shrink a class's badge.
 */

import { jsonResponse, preflight, withStoreErrors } from "../http.ts";
import type { RosterStore } from "../ports.ts";
import { rosterFilterFrom } from "./filter.ts";
import { type GuardDeps, guardRequest } from "./guard.ts";

export interface RosterListHandlerDeps extends GuardDeps {
  store: Pick<RosterStore, "list" | "listCarpools" | "countClassMembers">;
}

export function createRosterListHandler(deps: RosterListHandlerDeps) {
  return async function handle(request: Request): Promise<Response> {
    const options = preflight(request);
    if (options) return options;

    const guard = await guardRequest(request, deps);
    if (!guard.ok) return guard.response;

    return await withStoreErrors(async () => {
      const [students, carpools, classMemberCounts] = await Promise.all([
        deps.store.list(rosterFilterFrom(guard.body)),
        deps.store.listCarpools(),
        deps.store.countClassMembers(),
      ]);
      return jsonResponse({ students, carpools, classMemberCounts });
    });
  };
}
