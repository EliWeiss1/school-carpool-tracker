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
import { nameKey, nameTooLong, readAliases } from "./roster-input.ts";

export interface RosterImportHandlerDeps extends GuardDeps {
  store: Pick<
    RosterStore,
    "bulkCreateStudents" | "list" | "listCarpools" | "createCarpool"
  >;
}

/** Comfortably above any real school roster; a stop against a malformed body. */
const MAX_IMPORT_ROWS = 1000;

/** A row from the client, before its carpool name is resolved to an id. */
interface ImportRow extends Omit<StudentWriteInput, "carpool_id"> {
  /** The carpool name as typed in the file, or null for no carpool. */
  carpool: string | null;
}

function readStudentsInput(body: Record<string, unknown>): ImportRow[] | null {
  const raw = body.students;
  if (!Array.isArray(raw)) return null;

  const out: ImportRow[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return null;
    const row = entry as Record<string, unknown>;

    const firstName = readString(row, "first_name");
    const lastName = readString(row, "last_name");
    if (firstName === null || lastName === null) return null;
    if (
      nameTooLong(firstName, lastName, readString(row, "class_group"))
    )
      return null;

    out.push({
      first_name: firstName,
      last_name: lastName,
      aliases: readAliases(row),
      class_group: readString(row, "class_group"),
      carpool: readString(row, "carpool"),
    });
  }
  return out;
}

/**
 * Resolves each row's typed carpool name to an id, creating any carpool that
 * does not already exist -- by name, case-insensitively, matching the unique
 * index on `carpools.name`. Two rows naming the same new carpool share one
 * new row rather than each creating their own.
 */
async function resolveCarpools(
  store: RosterImportHandlerDeps["store"],
  rows: ImportRow[],
): Promise<StudentWriteInput[]> {
  const existing = await store.listCarpools();
  const byName = new Map(
    existing.map((carpool) => [carpool.name.toLowerCase(), carpool.id]),
  );

  const resolved: StudentWriteInput[] = [];
  for (const { carpool, ...rest } of rows) {
    if (carpool === null) {
      resolved.push({ ...rest, carpool_id: null });
      continue;
    }

    const key = carpool.toLowerCase();
    let carpoolId = byName.get(key);
    if (carpoolId === undefined) {
      const created = await store.createCarpool({ name: carpool, aliases: [] });
      carpoolId = created.id;
      byName.set(key, carpoolId);
    }
    resolved.push({ ...rest, carpool_id: carpoolId });
  }
  return resolved;
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
      // Reject the whole import if any child is already on the roster.
      //
      // The realistic trigger is not malice, it is a lost response: the insert
      // commits, school wifi drops the reply, the admin presses Import again.
      // A duplicated roster is not cosmetic -- two identical rows score
      // identically in the resolver, so the margin between them is 0, below
      // MATCH_POLICY.clearMargin, and the "clear" tier stops existing for
      // every child in the school. Every pickup becomes a two-tap choice
      // between two buttons the person outside cannot tell apart.
      //
      // This is a check-then-write and therefore racy under two simultaneous
      // imports. That is acceptable here -- imports come from one office
      // computer, a term at a time -- but a unique index on
      // (lower(first_name), lower(last_name)) is the real fix and is the
      // recommended follow-up.
      const existing = await deps.store.list({});
      const onRoster = new Set(
        existing.map((student) =>
          nameKey(student.first_name, student.last_name),
        ),
      );

      const collision = students.find((student) =>
        onRoster.has(nameKey(student.first_name, student.last_name)),
      );
      if (collision) {
        return errorResponse(
          409,
          `${collision.first_name} ${collision.last_name} is already on the roster, so nothing was imported. Remove the students who are already listed and import again.`,
        );
      }

      // Carpools named in the file are created (or matched by name) before
      // any student row is written, so every row that names one lands with
      // its carpool_id already set rather than needing a second pass.
      const withCarpools = await resolveCarpools(deps.store, students);

      const created = await deps.store.bulkCreateStudents(withCarpools);
      return jsonResponse({ created: created.length, students: created });
    });
  };
}
