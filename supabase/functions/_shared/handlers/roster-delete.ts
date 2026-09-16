/**
 * POST /roster-delete — remove one student from the roster, or several at
 * once for a bulk clean-up (a botched import, a year-end wipe).
 *
 * Accepts either a single `studentId` or a `studentIds` array, the same
 * plural-or-singular convention `set-status` established: the response is
 * always the plural shape below, with a single delete simply being the
 * one-element case of it. Deleting is more dangerous than a roster edit --
 * unlike an edit it cannot be undone by another admin write -- but it is
 * guarded exactly like every other write here (rate limit, then PIN), and it
 * does nothing to `status_events` -- the migration's
 * `student_id ... on delete set null` foreign key handles preserving that
 * child's audit history at the database level, so there is nothing for this
 * handler to get wrong there. A student's `student_parents` row, if any, IS
 * deleted (cascade) -- there is no audit reason to keep a parent name around
 * for a child no longer on the roster.
 */

import {
  errorResponse,
  jsonResponse,
  preflight,
  readIdOrIds,
  withStoreErrors,
} from "../http.ts";
import type { RosterStore } from "../ports.ts";
import { type GuardDeps, guardRequest } from "./guard.ts";

export interface RosterDeleteHandlerDeps extends GuardDeps {
  store: Pick<RosterStore, "removeStudents">;
}

/** Comfortably above a real bad-import clean-up (the school's actual
 *  motivating case was 54 rows) without being unbounded. */
const MAX_DELETE_IDS = 500;

export function createRosterDeleteHandler(deps: RosterDeleteHandlerDeps) {
  return async function handle(request: Request): Promise<Response> {
    const options = preflight(request);
    if (options) return options;

    const guard = await guardRequest(request, deps);
    if (!guard.ok) return guard.response;

    const studentIds = readIdOrIds(
      guard.body,
      "studentId",
      "studentIds",
      MAX_DELETE_IDS,
    );
    if (studentIds === null) {
      return errorResponse(400, "No student was chosen to remove.");
    }

    return await withStoreErrors(async () => {
      const deletedIds = await deps.store.removeStudents(studentIds);
      const deleted = new Set(deletedIds);
      const missingIds = studentIds.filter((id) => !deleted.has(id));

      if (deletedIds.length === 0) {
        return errorResponse(404, "That student is not on the roster.");
      }

      return jsonResponse({ deletedIds, missingIds });
    });
  };
}
