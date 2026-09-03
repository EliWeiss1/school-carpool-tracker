/**
 * POST /roster-delete — remove one student from the roster.
 *
 * The single most dangerous endpoint added in phase 6: unlike a roster edit
 * this one cannot be undone by another admin write. It is guarded exactly like
 * every other write here (rate limit, then PIN), and it does nothing to
 * `status_events` -- the migration's `student_id ... on delete set null`
 * foreign key handles preserving that child's audit history at the database
 * level, so there is nothing for this handler to get wrong there.
 */

import {
  errorResponse,
  jsonResponse,
  preflight,
  readString,
  withStoreErrors,
} from "../http.ts";
import type { RosterStore } from "../ports.ts";
import { type GuardDeps, guardRequest } from "./guard.ts";

export interface RosterDeleteHandlerDeps extends GuardDeps {
  store: Pick<RosterStore, "removeStudent">;
}

export function createRosterDeleteHandler(deps: RosterDeleteHandlerDeps) {
  return async function handle(request: Request): Promise<Response> {
    const options = preflight(request);
    if (options) return options;

    const guard = await guardRequest(request, deps);
    if (!guard.ok) return guard.response;

    const studentId = readString(guard.body, "studentId");
    if (studentId === null) {
      return errorResponse(400, "No student was chosen to remove.");
    }

    return await withStoreErrors(async () => {
      const removed = await deps.store.removeStudent(studentId);
      if (!removed) {
        return errorResponse(404, "That student is not on the roster.");
      }
      return jsonResponse({ deleted: true });
    });
  };
}
