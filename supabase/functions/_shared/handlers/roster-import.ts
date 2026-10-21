/**
 * POST /roster-import — bulk-create the students from a confirmed CSV import.
 *
 * The validation report (headers, blank rows, duplicates, broken rows) is
 * `src/lib/csv-import.ts`'s job, entirely client-side, and a person has to
 * confirm the preview before this is ever called. None of that is trusted
 * here regardless: every row is re-validated the same way a single
 * /roster-write create is, and the whole request is rejected rather than
 * silently dropping one bad row from a school roster.
 *
 * Each row's classes arrive as `class_groups`, names resolved to ids here
 * exactly as /roster-write does. The first name that is not a class fails the
 * whole import (422) before anything -- including a new carpool -- is written.
 * The retired singular `class_group` on any row is a 400.
 */

import {
  errorResponse,
  jsonResponse,
  preflight,
  readString,
  withStoreErrors,
} from "../http.ts";
import type { RosterStore, StudentWriteInput } from "../ports.ts";
import {
  OUT_OF_DATE_MESSAGE,
  readClassNames,
  sendsLegacyClassGroup,
  unknownClassMessage,
} from "./class-input.ts";
import { type GuardDeps, guardRequest } from "./guard.ts";
import {
  nameKey,
  nameTooLong,
  readAliases,
  resolveClassNames,
} from "./roster-input.ts";

export interface RosterImportHandlerDeps extends GuardDeps {
  store: Pick<
    RosterStore,
    | "bulkCreateStudents"
    | "list"
    | "listCarpools"
    | "createCarpool"
    | "listClassGroups"
  >;
}

/** Comfortably above any real school roster; a stop against a malformed body. */
const MAX_IMPORT_ROWS = 1000;

const NO_VALID_STUDENTS =
  "No valid students were sent to import. Re-check the file and try again.";

/** A row from the client, before its carpool and class names become ids. */
interface ParsedRow extends Omit<
  StudentWriteInput,
  "carpool_id" | "class_group_ids"
> {
  /** The carpool name as typed in the file, or null for no carpool. */
  carpool: string | null;
  /** Class names as typed in the file; empty for no class. */
  classNames: string[];
}

/** A row with its classes resolved, still carrying its typed carpool name. */
interface ImportRow extends Omit<StudentWriteInput, "carpool_id"> {
  carpool: string | null;
}

type ParseResult =
  { ok: true; rows: ParsedRow[] } | { ok: false; message: string };

function readStudentsInput(body: Record<string, unknown>): ParseResult {
  const malformed: ParseResult = { ok: false, message: NO_VALID_STUDENTS };
  const raw = body.students;
  if (!Array.isArray(raw)) return malformed;

  const out: ParsedRow[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return malformed;
    const row = entry as Record<string, unknown>;

    // A stale client says so up front rather than being told its rows are bad.
    if (sendsLegacyClassGroup(row)) {
      return { ok: false, message: OUT_OF_DATE_MESSAGE };
    }

    const firstName = readString(row, "first_name");
    const lastName = readString(row, "last_name");
    if (firstName === null || lastName === null) return malformed;
    const parent1Name = readString(row, "parent1_name");
    const parent2Name = readString(row, "parent2_name");
    if (nameTooLong(firstName, lastName, parent1Name, parent2Name))
      return malformed;

    const classes = readClassNames(row);
    if (classes.kind === "invalid") return malformed;

    out.push({
      first_name: firstName,
      last_name: lastName,
      aliases: readAliases(row),
      classNames: classes.kind === "names" ? classes.names : [],
      carpool: readString(row, "carpool"),
      parent1_name: parent1Name,
      parent2_name: parent2Name,
    });
  }
  return { ok: true, rows: out };
}

/**
 * Resolves every row's class names to ids against the live class list. The
 * first unknown name, in row order, refuses the whole import.
 */
async function resolveClasses(
  store: RosterImportHandlerDeps["store"],
  rows: ParsedRow[],
): Promise<{ ok: true; rows: ImportRow[] } | { ok: false; unknown: string }> {
  const classes = await store.listClassGroups();

  const resolved: ImportRow[] = [];
  for (const { classNames, ...rest } of rows) {
    const result = resolveClassNames(classNames, classes);
    if (!result.ok) return { ok: false, unknown: result.unknown };
    resolved.push({ ...rest, class_group_ids: result.ids });
  }
  return { ok: true, rows: resolved };
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

    const parsed = readStudentsInput(guard.body);
    if (!parsed.ok) return errorResponse(400, parsed.message);
    if (parsed.rows.length === 0) {
      return errorResponse(400, NO_VALID_STUDENTS);
    }
    if (parsed.rows.length > MAX_IMPORT_ROWS) {
      return errorResponse(
        400,
        `That is too many students for one import (max ${MAX_IMPORT_ROWS}). Split the file and import it in parts.`,
      );
    }

    return await withStoreErrors(async () => {
      const withClasses = await resolveClasses(deps.store, parsed.rows);
      if (!withClasses.ok) {
        return errorResponse(422, unknownClassMessage(withClasses.unknown));
      }
      const students = withClasses.rows;

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
