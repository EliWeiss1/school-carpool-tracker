/**
 * POST /roster-write — add a student to the roster, or edit one already on it.
 *
 * One endpoint for both, the same way /set-status covers both directions of a
 * status change: the presence of `studentId` selects the branch, so there is
 * exactly one place that decides what a roster row is allowed to look like.
 *
 * Deliberately cannot touch `status` or `arrived_at` -- `StudentWriteInput`
 * has no room for either, so a caller sending them is silently ignored rather
 * than rejected. Status changes are audited elsewhere (/set-status,
 * /roster-reset); this endpoint would otherwise be a second, unaudited way to
 * flip a child to `arrived`.
 */

import {
  errorResponse,
  jsonResponse,
  preflight,
  readString,
  withStoreErrors,
} from "../http.ts";
import type { RosterStore, StudentWriteInput } from "../ports.ts";
import { type GuardDeps, guardRequest } from "./guard.ts";
import { readAliases } from "./roster-input.ts";

export interface RosterWriteHandlerDeps extends GuardDeps {
  store: Pick<RosterStore, "createStudent" | "updateStudent">;
}

export function createRosterWriteHandler(deps: RosterWriteHandlerDeps) {
  return async function handle(request: Request): Promise<Response> {
    const options = preflight(request);
    if (options) return options;

    const guard = await guardRequest(request, deps);
    if (!guard.ok) return guard.response;

    const studentId = readString(guard.body, "studentId");

    return await withStoreErrors(async () => {
      if (studentId === null) {
        return await create(deps, guard.body);
      }
      return await update(deps, studentId, guard.body);
    });
  };
}

async function create(
  deps: RosterWriteHandlerDeps,
  body: Record<string, unknown>,
): Promise<Response> {
  const firstName = readString(body, "first_name");
  const lastName = readString(body, "last_name");
  if (firstName === null || lastName === null) {
    return errorResponse(400, "A student needs a first and last name.");
  }

  const input: StudentWriteInput = {
    first_name: firstName,
    last_name: lastName,
    aliases: readAliases(body),
    grade: readString(body, "grade"),
    class_group: readString(body, "class_group"),
  };

  const student = await deps.store.createStudent(input);
  return jsonResponse({ student, created: true });
}

async function update(
  deps: RosterWriteHandlerDeps,
  studentId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const patch: Partial<StudentWriteInput> = {};

  // Only a field actually present in the request is touched, so a partial
  // edit -- e.g. changing just a grade from the roster table -- cannot blank
  // out every other column by omission.
  if ("first_name" in body) {
    const firstName = readString(body, "first_name");
    if (firstName === null) {
      return errorResponse(400, "A student's first name cannot be blank.");
    }
    patch.first_name = firstName;
  }

  if ("last_name" in body) {
    const lastName = readString(body, "last_name");
    if (lastName === null) {
      return errorResponse(400, "A student's last name cannot be blank.");
    }
    patch.last_name = lastName;
  }

  if ("aliases" in body) patch.aliases = readAliases(body);
  if ("grade" in body) patch.grade = readString(body, "grade");
  if ("class_group" in body) patch.class_group = readString(body, "class_group");

  const student = await deps.store.updateStudent(studentId, patch);
  if (student === null) {
    return errorResponse(404, "That student is not on the roster.");
  }
  return jsonResponse({ student, created: false });
}
