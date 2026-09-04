/**
 * POST /resolve-name — turn what Deepgram heard into ranked roster candidates.
 *
 * This endpoint reads. It never writes: the status change happens only after a
 * human taps one of the candidates it returns, in /set-status. Keeping those
 * apart is what makes "a transcription never auto-writes" true by construction
 * rather than by care.
 *
 * Carpools are folded into the same ranking pass rather than matched
 * separately: a carpool is added to the candidate pool as one more
 * `ResolverStudent` (its name standing in for a surname), ranked exactly like
 * a student, then candidates sharing a `carpool_id` are collapsed into one
 * result before the tier policy runs. The collapse is why this endpoint calls
 * `rankCandidates` + `tierFor` rather than the combined `resolveName`: two
 * siblings who each score 1.00 on their own surname have a margin of zero
 * between them, which is exactly what MATCH_POLICY.clearMargin is meant to
 * withhold a pre-highlight over -- but collapsed into one carpool candidate,
 * that margin is measured against the next-best *different* family, which is
 * the comparison that actually matters for "should this one tap be trusted".
 */

import {
  errorResponse,
  jsonResponse,
  preflight,
  readString,
  withStoreErrors,
} from "../http.ts";
import type { CarpoolRow, RosterStore, StudentRow } from "../ports.ts";
import {
  type RankedCandidate,
  type ResolverStudent,
  type TranscriptAlternative,
  MATCH_POLICY,
  rankCandidates,
  tierFor,
} from "../resolver.ts";
import { rosterFilterFrom } from "./filter.ts";
import { type GuardDeps, guardRequest } from "./guard.ts";

export interface ResolveHandlerDeps extends GuardDeps {
  store: Pick<RosterStore, "list" | "listCarpools">;
}

/** Just enough of a student for a tap target. */
function candidateStudent(student: StudentRow) {
  return {
    id: student.id,
    first_name: student.first_name,
    last_name: student.last_name,
    class_group: student.class_group,
    status: student.status,
  };
}

type Target = ResolverStudent & {
  /** "student:<uuid>" or "carpool:<uuid>", so a mixed roster+carpool pool
   *  can be built as one ResolverStudent[] with no id collisions. */
  kind: "student" | "carpool";
  studentRow: StudentRow | null;
};

function targetsFor(students: StudentRow[], carpools: CarpoolRow[]): Target[] {
  const studentTargets: Target[] = students.map((student) => ({
    id: `student:${student.id}`,
    first_name: student.first_name,
    last_name: student.last_name,
    aliases: student.aliases,
    kind: "student",
    studentRow: student,
  }));

  // An empty first name folds the "full_name" key onto the surname key in
  // rosterKeys' own dedupe, so a carpool needs no special-casing there --
  // the resolver sees it as a student with only a last name.
  const carpoolTargets: Target[] = carpools.map((carpool) => ({
    id: `carpool:${carpool.id}`,
    first_name: "",
    last_name: carpool.name,
    aliases: carpool.aliases,
    kind: "carpool",
    studentRow: null,
  }));

  return [...studentTargets, ...carpoolTargets];
}

/** Group key: the carpool a candidate belongs to, or its own student id when it has none. */
function groupKeyFor(candidate: RankedCandidate<Target>): string {
  if (candidate.student.kind === "carpool") return candidate.student.id;
  const carpoolId = candidate.student.studentRow?.carpool_id;
  return carpoolId ? `carpool:${carpoolId}` : candidate.student.id;
}

export interface ResolvedGroup {
  score: number;
  matchedOn: string;
  matchedVia: RankedCandidate<Target>["matchedVia"];
  viaPhonetic: boolean;
  clearEligible: boolean;
  /** Every member, in roster order. A lone student's group has exactly one. */
  members: StudentRow[];
  carpoolId: string | null;
}

/**
 * Collapses ranked candidates sharing a carpool into one group, keeping the
 * best-scoring member's score and match metadata for the group as a whole.
 * Groups are re-sorted and re-capped, because collapsing can change the
 * relative order (a carpool with a merely-good second member can outrank a
 * lone student who was individually a hair ahead).
 */
function collapseByCarpool(
  ranked: RankedCandidate<Target>[],
  carpoolMembers: Map<string, StudentRow[]>,
  maxCandidates: number,
): ResolvedGroup[] {
  const groups = new Map<string, ResolvedGroup>();

  for (const candidate of ranked) {
    const key = groupKeyFor(candidate);
    const existing = groups.get(key);

    if (existing && existing.score >= candidate.score) continue;

    const isCarpoolTarget = candidate.student.kind === "carpool";
    const carpoolId = isCarpoolTarget
      ? candidate.student.id.slice("carpool:".length)
      : (candidate.student.studentRow?.carpool_id ?? null);

    // Whichever target won -- the carpool's own name, or one member's
    // surname -- the group is the WHOLE carpool, not just the name that
    // happened to match best. A lone student with no carpool is a group of one.
    const members =
      carpoolId !== null
        ? (carpoolMembers.get(carpoolId) ?? [])
        : candidate.student.studentRow
          ? [candidate.student.studentRow]
          : [];
    if (members.length === 0) continue;

    groups.set(key, {
      score: candidate.score,
      matchedOn: candidate.matchedOn,
      matchedVia: candidate.matchedVia,
      viaPhonetic: candidate.viaPhonetic,
      clearEligible: candidate.clearEligible,
      members,
      carpoolId,
    });
  }

  return [...groups.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCandidates);
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
      const [roster, carpools] = await Promise.all([
        deps.store.list(rosterFilterFrom(guard.body)),
        deps.store.listCarpools(),
      ]);

      const carpoolMembers = new Map<string, StudentRow[]>();
      for (const student of roster) {
        if (!student.carpool_id) continue;
        const members = carpoolMembers.get(student.carpool_id) ?? [];
        members.push(student);
        carpoolMembers.set(student.carpool_id, members);
      }

      const targets = targetsFor(roster, carpools);
      // Ask for more raw candidates than will be shown: the collapse below
      // can only merge candidates that both made it into this list, so
      // asking for exactly maxCandidates would starve it whenever two
      // carpool-mates each rank inside the top few on their own.
      const { candidates: ranked, transcript } = rankCandidates(
        alternatives,
        targets,
        { maxCandidates: MATCH_POLICY.maxCandidates * 3 },
      );

      const groups = collapseByCarpool(
        ranked,
        carpoolMembers,
        MATCH_POLICY.maxCandidates,
      );
      const tier = tierFor(groups);

      return jsonResponse({
        tier,
        transcript,
        candidates: groups.map((group) => ({
          score: group.score,
          matchedOn: group.matchedOn,
          matchedVia: group.matchedVia,
          students: group.members.map(candidateStudent),
          carpool: group.carpoolId
            ? {
                id: group.carpoolId,
                name:
                  carpools.find((carpool) => carpool.id === group.carpoolId)
                    ?.name ?? "",
              }
            : null,
        })),
      });
    });
  };
}
