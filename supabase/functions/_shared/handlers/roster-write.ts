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
import { nameKey, nameTooLong, readAliases } from "./roster-input.ts";

export interface RosterWriteHandlerDeps extends GuardDeps {
  store: Pick<RosterStore, "createStudent" | "updateStudent" | "list">;
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

  const classGroup = readString(body, "class_group");
  const carpoolId = readString(body, "carpool_id");
  if (nameTooLong(firstName, lastName, classGroup)) {
    return errorResponse(
      400,
      "One of those entries is far too long to be a name. Check the row for a stray quotation mark.",
    );
  }

  // Adding the same child twice is what a double-tapped Add button does, and a
  // duplicated roster row breaks the matcher rather than merely cluttering it:
  // two identical rows score identically, the margin between them is 0, and
  // the "clear" tier stops existing for every child in the school.
  const existing = await deps.store.list({});
  const alreadyOnRoster = existing.some(
    (student) =>
      nameKey(student.first_name, student.last_name) ===
      nameKey(firstName, lastName),
  );
  if (alreadyOnRoster) {
    return errorResponse(
      409,
      `${firstName} ${lastName} is already on the roster. Edit the existing entry instead of adding a second one.`,
    );
  }

  const input: StudentWriteInput = {
    first_name: firstName,
    last_name: lastName,
    aliases: readAliases(body),
    class_group: classGroup,
    carpool_id: carpoolId,
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
  // edit -- e.g. changing just a class from the roster table -- cannot blank
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
  if ("class_group" in body)
    patch.class_group = readString(body, "class_group");
  if ("carpool_id" in body) patch.carpool_id = readString(body, "carpool_id");

  if (
    nameTooLong(
      patch.first_name ?? null,
      patch.last_name ?? null,
      patch.class_group ?? null,
    )
  ) {
    return errorResponse(
      400,
      "One of those entries is far too long to be a name. Check the row for a stray quotation mark.",
    );
  }

  const student = await deps.store.updateStudent(studentId, patch);
  if (student === null) {
    return errorResponse(404, "That student is not on the roster.");
  }
  return jsonResponse({ student, created: false });
}
