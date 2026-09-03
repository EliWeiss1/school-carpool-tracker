/**
 * POST /set-status — the only write path in the app.
 *
 * It re-validates the PIN itself rather than trusting that /resolve-name did:
 * these are separate HTTP calls, and the browser between them is not part of the
 * trust boundary. It also re-reads nothing from the resolver — the caller sends
 * a student id that a human tapped, and the score comes along only to be logged.
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
  StudentStatus,
} from "../ports.ts";
import { type GuardDeps, guardRequest } from "./guard.ts";

export interface StatusHandlerDeps extends GuardDeps {
  store: RosterStore;
}

const STATUSES: StudentStatus[] = ["waiting", "arrived"];
const SOURCES: StatusEventSource[] = ["voice", "manual", "admin"];

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

export function createStatusHandler(deps: StatusHandlerDeps) {
  return async function handle(request: Request): Promise<Response> {
    const options = preflight(request);
    if (options) return options;

    const guard = await guardRequest(request, deps);
    if (!guard.ok) return guard.response;

    const studentId = readString(guard.body, "studentId");
    if (studentId === null) {
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

    return await withStoreErrors(async () => {
      // arrived_at is never read off the request: a database trigger derives it
      // from the transition, so a stale phone cannot rewrite a pickup time.
      const updated = await deps.store.setStatus(studentId, status);

      if (updated === null) {
        const existing = await deps.store.get(studentId);
        if (existing === null) {
          return errorResponse(404, "That student is not on the roster.");
        }
        // Already in the requested status: somebody else got there first.
        // Report the settled state without logging a second event or flashing
        // the board.
        return jsonResponse({
          student: existing,
          changed: false,
          logged: true,
        });
      }

      // The status change stands whatever happens here -- the display has
      // already flashed, and undoing it would be worse than a gap in the log --
      // but the caller is told, so a persistent failure is visible to someone.
      const logged = await deps.store.logEvent({
        studentId,
        changedTo: status,
        source,
        matchConfidence:
          source === "voice"
            ? readConfidence(guard.body.matchConfidence)
            : null,
        rawTranscript:
          source === "voice" ? readString(guard.body, "transcript") : null,
      });

      return jsonResponse({ student: updated, changed: true, logged });
    });
  };
}
