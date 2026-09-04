/**
 * POST /set-status — the only write path in the app.
 *
 * It re-validates the PIN itself rather than trusting that /resolve-name did:
 * these are separate HTTP calls, and the browser between them is not part of the
 * trust boundary. It also re-reads nothing from the resolver — the caller sends
 * a student id that a human tapped, and the score comes along only to be logged.
 *
 * Accepts either a single `studentId` or a `studentIds` array, so confirming a
 * whole carpool in one tap is the same endpoint and the same one-tap-confirms
 * rule as confirming one child: the response is always the plural shape below,
 * with a single confirm simply being the one-element case of it.
 */

import {
  errorResponse,
  jsonResponse,
  preflight,
  readString,
  withStoreErrors,
} from "../http.ts";
import type {
  RosterStore,
  StatusEventSource,
  StudentRow,
  StudentStatus,
} from "../ports.ts";
import { type GuardDeps, guardRequest } from "./guard.ts";

export interface StatusHandlerDeps extends GuardDeps {
  store: RosterStore;
}

const STATUSES: StudentStatus[] = ["waiting", "arrived"];
const SOURCES: StatusEventSource[] = ["voice", "manual", "admin"];

/** A carpool is a car, not a bus -- this is a stop against a malformed body. */
const MAX_STUDENT_IDS = 20;

function readStatus(value: unknown): StudentStatus | null {
  return typeof value === "string" && (STATUSES as string[]).includes(value)
    ? (value as StudentStatus)
    : null;
}

/**
 * Required, with no default. A client that forgets to send it used to log a
 * voice confirmation as hand-picked, dropping the transcript and the score --
 * silently hollowing out the corpus MATCH_POLICY is meant to be retuned from.
 */
function readSource(value: unknown): StatusEventSource | null {
  return typeof value === "string" && (SOURCES as string[]).includes(value)
    ? (value as StatusEventSource)
    : null;
}

/** Only a real 0-1 score is worth logging; anything else is noise, not evidence. */
function readConfidence(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
    ? value
    : null;
}

/** Accepts either a single `studentId` or a `studentIds` array; never both mixed. */
function readStudentIds(body: Record<string, unknown>): string[] | null {
  if (Array.isArray(body.studentIds)) {
    const ids = body.studentIds.filter(
      (id): id is string => typeof id === "string" && id.trim() !== "",
    );
    return ids.length === 0 ? null : ids.slice(0, MAX_STUDENT_IDS);
  }
  const single = readString(body, "studentId");
  return single === null ? null : [single];
}

function readCarpoolId(body: Record<string, unknown>): string | null {
  return readString(body, "carpoolId");
}

export function createStatusHandler(deps: StatusHandlerDeps) {
  return async function handle(request: Request): Promise<Response> {
    const options = preflight(request);
    if (options) return options;

    const guard = await guardRequest(request, deps);
    if (!guard.ok) return guard.response;

    const studentIds = readStudentIds(guard.body);
    if (studentIds === null) {
      return errorResponse(400, "No student was chosen.");
    }

    const status = readStatus(guard.body.status);
    if (status === null) {
      return errorResponse(
        400,
        "A student can only be set to waiting or arrived.",
      );
    }

    const source = readSource(guard.body.source);
    if (source === null) {
      return errorResponse(
        400,
        "That is not a status change this app records.",
      );
    }

    const carpoolId = readCarpoolId(guard.body);

    return await withStoreErrors(async () => {
      // arrived_at is never read off the request: a database trigger derives it
      // from the transition, so a stale phone cannot rewrite a pickup time.
      const changedRows = await deps.store.setStatusMany(studentIds, status);
      const changedIds = new Set(changedRows.map((row) => row.id));

      // A student absent from `changedRows` is either already in the
      // requested status (somebody else got there first -- report the
      // settled state, no second flash, no second audit row) or not on the
      // roster at all (only worth naming as `missing`, never a 404: a
      // carpool confirm where two of three members exist should still
      // confirm those two).
      const settled: StudentRow[] = [...changedRows];
      const missing: string[] = [];
      for (const id of studentIds) {
        if (changedIds.has(id)) continue;
        const existing = await deps.store.get(id);
        if (existing === null) {
          missing.push(id);
        } else {
          settled.push(existing);
        }
      }

      if (settled.length === 0) {
        return errorResponse(404, "That student is not on the roster.");
      }

      // The status change stands whatever happens here -- the display has
      // already flashed, and undoing it would be worse than a gap in the log --
      // but the caller is told, so a persistent failure is visible to someone.
      let logged = 0;
      for (const row of changedRows) {
        const ok = await deps.store.logEvent({
          studentId: row.id,
          changedTo: status,
          source,
          matchConfidence:
            source === "voice"
              ? readConfidence(guard.body.matchConfidence)
              : null,
          rawTranscript:
            source === "voice" ? readString(guard.body, "transcript") : null,
          carpoolId,
        });
        if (ok) logged++;
      }

      return jsonResponse({
        students: settled,
        changed: changedRows.map((row) => row.id),
        logged,
        missing,
      });
    });
  };
}
