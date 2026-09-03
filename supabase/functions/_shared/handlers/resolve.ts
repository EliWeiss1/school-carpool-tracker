/**
 * POST /resolve-name — turn what Deepgram heard into ranked roster candidates.
 *
 * This endpoint reads. It never writes: the status change happens only after a
 * human taps one of the candidates it returns, in /set-status. Keeping those
 * apart is what makes "a transcription never auto-writes" true by construction
 * rather than by care.
 */

import {
  errorResponse,
  jsonResponse,
  preflight,
  readString,
  withStoreErrors,
} from "../http.ts";
import type { RosterStore, StudentRow } from "../ports.ts";
import { type TranscriptAlternative, resolveName } from "../resolver.ts";
import { rosterFilterFrom } from "./filter.ts";
import { type GuardDeps, guardRequest } from "./guard.ts";

export interface ResolveHandlerDeps extends GuardDeps {
  store: Pick<RosterStore, "list">;
}

/** Just enough of a student for a tap target. */
function candidateStudent(student: StudentRow) {
  return {
    id: student.id,
    first_name: student.first_name,
    last_name: student.last_name,
    grade: student.grade,
    class_group: student.class_group,
    status: student.status,
  };
}

/**
 * Accept either Deepgram's alternatives array or a single transcript, so the
 * typed-search fallback and the mock mode can use the same endpoint.
 */
function readAlternatives(
  body: Record<string, unknown>,
): TranscriptAlternative[] {
  const raw = body.alternatives;

  if (Array.isArray(raw)) {
    return raw
      .filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === "object" && entry !== null,
      )
      .map((entry) => ({
        transcript:
          typeof entry.transcript === "string" ? entry.transcript : "",
        confidence:
          typeof entry.confidence === "number" ? entry.confidence : undefined,
      }))
      .filter((alternative) => alternative.transcript.trim() !== "");
  }

  const single = readString(body, "transcript");
  return single === null ? [] : [{ transcript: single }];
}

export function createResolveHandler(deps: ResolveHandlerDeps) {
  return async function handle(request: Request): Promise<Response> {
    const options = preflight(request);
    if (options) return options;

    const guard = await guardRequest(request, deps);
    if (!guard.ok) return guard.response;

    const alternatives = readAlternatives(guard.body);
    if (alternatives.length === 0) {
      return errorResponse(
        400,
        "Nothing was heard. Try again, or use the typed search.",
      );
    }

    return await withStoreErrors(async () => {
      const roster = await deps.store.list(rosterFilterFrom(guard.body));
      const result = resolveName(alternatives, roster);

      return jsonResponse({
        tier: result.tier,
        transcript: result.transcript,
        candidates: result.candidates.map((candidate) => ({
          student: candidateStudent(candidate.student),
          score: candidate.score,
          matchedOn: candidate.matchedOn,
          matchedVia: candidate.matchedVia,
        })),
      });
    });
  };
}
