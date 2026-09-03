/**
 * POST /roster-import — bulk-create the students from a confirmed CSV import.
 *
 * The validation report (headers, blank rows, duplicates, broken rows) is
 * `src/lib/csv-import.ts`'s job, entirely client-side, and a person has to
 * confirm the preview before this is ever called. None of that is trusted
 * here regardless: every row is re-validated the same way a single
 * /roster-write create is, and the whole request is rejected rather than
 * silently dropping one bad row from a school roster.
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

export interface RosterImportHandlerDeps extends GuardDeps {
  store: Pick<RosterStore, "bulkCreateStudents">;
}

/** Comfortably above any real school roster; a stop against a malformed body. */
const MAX_IMPORT_ROWS = 1000;

function readStudentsInput(
  body: Record<string, unknown>,
): StudentWriteInput[] | null {
  const raw = body.students;
  if (!Array.isArray(raw)) return null;

  const out: StudentWriteInput[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return null;
    const row = entry as Record<string, unknown>;

    const firstName = readString(row, "first_name");
    const lastName = readString(row, "last_name");
    if (firstName === null || lastName === null) return null;

    out.push({
      first_name: firstName,
      last_name: lastName,
      aliases: readAliases(row),
      grade: readString(row, "grade"),
      class_group: readString(row, "class_group"),
    });
  }
  return out;
}

export function createRosterImportHandler(deps: RosterImportHandlerDeps) {
  return async function handle(request: Request): Promise<Response> {
    const options = preflight(request);
    if (options) return options;

    const guard = await guardRequest(request, deps);
    if (!guard.ok) return guard.response;

    const students = readStudentsInput(guard.body);
    if (students === null || students.length === 0) {
      return errorResponse(
        400,
        "No valid students were sent to import. Re-check the file and try again.",
      );
    }
    if (students.length > MAX_IMPORT_ROWS) {
      return errorResponse(
        400,
        `That is too many students for one import (max ${MAX_IMPORT_ROWS}). Split the file and import it in parts.`,
      );
    }

    return await withStoreErrors(async () => {
      const created = await deps.store.bulkCreateStudents(students);
      return jsonResponse({ created: created.length, students: created });
    });
  };
}
