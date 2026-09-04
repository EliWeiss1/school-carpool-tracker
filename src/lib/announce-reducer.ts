/**
 * The state machine behind `/announce`, as a pure reducer.
 *
 * `announce-screen.tsx` does the I/O — calling `api.ts`, driving the mock (or
 * real) speech source, ticking a clock for the undo countdown — and dispatches
 * an action for every outcome. This file only decides what the screen looks
 * like *after* that outcome, which is the part CLAUDE.md asks to be tested
 * without rendering anything: every branch here is covered by
 * `announce-reducer.test.ts` with no DOM, no network and no timers.
 *
 * A few rules worth calling out because they encode requirements from
 * CLAUDE.md rather than being arbitrary:
 * - A transcription never auto-writes a status change, so nothing in here
 *   ever produces a "confirmed" state except in direct response to a
 *   `set-status` result the caller already received.
 * - A student absent from `changedIds` is reported calmly (`info`), never as
 *   a `banner` — it is not a failure, someone else just got there first.
 * - `logged < changedIds.length` is a quiet `warning`-tone banner and never
 *   touches `undo` — the status change itself is never in question.
 * - `undo/expire` carries the `studentIds` it is expiring so a stale timer
 *   from a superseded confirmation can never clobber a newer one.
 * - Multi-select is opt-in and defaults off: a tap on a single candidate
 *   confirms it immediately, exactly as it always has. Turning "Announce
 *   several" on is what makes a tap a checkbox instead of a confirm.
 */

import type { CandidateStudent, MatchTier, MatchedVia } from "@/lib/api";
import type { SpeechStatus } from "@/lib/speech-mock";

/** Structurally identical to `ResolveCandidate` from `api.ts` — redeclared so
 *  this module (and its tests) do not have to import React-adjacent wiring. */
export interface ResolveCandidateLike {
  /** The one student, or every member of the carpool. Never empty. */
  students: CandidateStudent[];
  /** Present only when this candidate is a whole carpool. */
  carpool: { id: string; name: string } | null;
  score: number;
  matchedOn: string;
  matchedVia: MatchedVia;
}

/** A stable identity for a candidate, for selection state and confirm tracking. */
export function candidateKey(candidate: ResolveCandidateLike): string {
  return candidate.carpool
    ? `carpool:${candidate.carpool.id}`
    : `student:${candidate.students[0].id}`;
}

/** What a staff member reads on the button/banner for one candidate. */
export function candidateLabel(candidate: ResolveCandidateLike): string {
  if (candidate.carpool) return candidate.carpool.name;
  const { first_name, last_name } = candidate.students[0];
  return `${first_name} ${last_name}`;
}

export type ResolveOrigin = "voice" | "manual";

export interface AnnounceFilter {
  classGroup: string;
}

export interface AnnounceResults {
  origin: ResolveOrigin;
  tier: MatchTier;
  transcript: string;
  candidates: ResolveCandidateLike[];
}

export interface AnnounceBanner {
  tone: "error" | "warning";
  message: string;
}

export interface UndoState {
  studentIds: string[];
  displayName: string;
  carpoolId: string | null;
  /** `Date.now()` when `set-status` reported at least one changed id. */
  confirmedAt: number;
}

export interface AnnounceState {
  filter: AnnounceFilter;
  searchText: string;
  micStatus: SpeechStatus;
  resolving: boolean;
  results: AnnounceResults | null;
  /** True once "Announce several" is toggled on; tapping a candidate then selects instead of confirming. */
  multiSelect: boolean;
  /** Candidate keys currently checked, only meaningful while multiSelect is on. */
  selectedKeys: string[];
  /** The candidate key (or "multi") currently mid-flight through `set-status`, if any. */
  confirmingKey: string | null;
  banner: AnnounceBanner | null;
  /** A calm, non-error message: "already arrived", "nothing heard", etc. */
  info: string | null;
  undo: UndoState | null;
}

export function initialAnnounceState(): AnnounceState {
  return {
    filter: { classGroup: "" },
    searchText: "",
    micStatus: "idle",
    resolving: false,
    results: null,
    multiSelect: false,
    selectedKeys: [],
    confirmingKey: null,
    banner: null,
    info: null,
    undo: null,
  };
}

export type AnnounceAction =
  | { type: "filter/change"; field: keyof AnnounceFilter; value: string }
  | { type: "search/change"; value: string }
  | { type: "mic/status"; status: SpeechStatus }
  | { type: "mic/nothingHeard" }
  | { type: "resolve/start" }
  | {
      type: "resolve/success";
      origin: ResolveOrigin;
      tier: MatchTier;
      transcript: string;
      candidates: ResolveCandidateLike[];
    }
  | { type: "resolve/error"; banner: AnnounceBanner }
  | { type: "multiSelect/toggle" }
  | { type: "candidate/toggleSelect"; key: string }
  | { type: "confirm/start"; key: string }
  | {
      type: "confirm/settled";
      studentIds: string[];
      changedIds: string[];
      displayName: string;
      carpoolId: string | null;
      logged: number;
      confirmedAt: number;
    }
  | { type: "confirm/error"; banner: AnnounceBanner }
  | { type: "undo/start" }
  | { type: "undo/success" }
  | { type: "undo/error"; banner: AnnounceBanner }
  | { type: "undo/expire"; studentIds: string[] }
  | { type: "banner/dismiss" }
  | { type: "info/dismiss" };

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

export function announceReducer(
  state: AnnounceState,
  action: AnnounceAction,
): AnnounceState {
  switch (action.type) {
    case "filter/change":
      return {
        ...state,
        filter: { ...state.filter, [action.field]: action.value },
        // The keyterm list and the candidate pool are both scoped by the
        // filter, so a result matched against the old scope is stale.
        results: null,
        selectedKeys: [],
      };

    case "search/change":
      return { ...state, searchText: action.value };

    case "mic/status":
      return { ...state, micStatus: action.status };

    case "mic/nothingHeard":
      return {
        ...state,
        micStatus: "idle",
        results: null,
        selectedKeys: [],
        info: "Didn't catch that. Try again, or type the name below.",
      };

    case "resolve/start":
      return {
        ...state,
        resolving: true,
        banner: null,
        info: null,
      };

    case "resolve/success":
      return {
        ...state,
        resolving: false,
        selectedKeys: [],
        results: {
          origin: action.origin,
          tier: action.tier,
          transcript: action.transcript,
          candidates: action.candidates,
        },
      };

    case "resolve/error":
      return {
        ...state,
        resolving: false,
        results: null,
        selectedKeys: [],
        banner: action.banner,
      };

    case "multiSelect/toggle":
      return { ...state, multiSelect: !state.multiSelect, selectedKeys: [] };

    case "candidate/toggleSelect": {
      const isSelected = state.selectedKeys.includes(action.key);
      return {
        ...state,
        selectedKeys: isSelected
          ? state.selectedKeys.filter((key) => key !== action.key)
          : [...state.selectedKeys, action.key],
      };
    }

    case "confirm/start":
      return { ...state, confirmingKey: action.key, banner: null };

    case "confirm/settled": {
      const settled: AnnounceState = {
        ...state,
        confirmingKey: null,
        results: null,
        selectedKeys: [],
      };

      const total = action.studentIds.length;
      const changedCount = action.changedIds.length;
      const subject = pluralize(total, "is", "are");

      if (changedCount === 0) {
        // Somebody else already confirmed everyone here. True and calm, not
        // an error — and no new undo window, because nothing changed here.
        return {
          ...settled,
          info: `${action.displayName} ${pluralize(total, "was", "were")} already marked arrived.`,
        };
      }

      const undo: UndoState = {
        studentIds: action.changedIds,
        displayName: action.displayName,
        carpoolId: action.carpoolId,
        confirmedAt: action.confirmedAt,
      };

      const partial = changedCount < total;
      const baseMessage = partial
        ? `${changedCount} of ${total} in ${action.displayName} ${subject} now arrived (the rest were already).`
        : `${action.displayName} ${subject} marked arrived.`;

      if (action.logged < changedCount) {
        // The status change stands regardless — see status.ts — so the undo
        // window is real. Only some audit rows are missing, surfaced quietly.
        return {
          ...settled,
          undo,
          banner: {
            tone: "warning",
            message: `${baseMessage.replace(/\.$/, "")}, but the confirmation was not fully logged.`,
          },
        };
      }

      return { ...settled, undo, info: baseMessage };
    }

    case "confirm/error":
      return { ...state, confirmingKey: null, banner: action.banner };

    case "undo/start":
      return { ...state, banner: null };

    case "undo/success":
      return {
        ...state,
        undo: null,
        info: state.undo
          ? `Undo confirmed — ${state.undo.displayName} ${pluralize(state.undo.studentIds.length, "is", "are")} back to waiting.`
          : "Undo confirmed.",
      };

    case "undo/error":
      return { ...state, banner: action.banner };

    case "undo/expire":
      // Only clear the window if it still belongs to the confirmation the
      // timer was set for — a stale timer must never clobber a newer one.
      return state.undo &&
        state.undo.studentIds.length === action.studentIds.length &&
        state.undo.studentIds.every((id) => action.studentIds.includes(id))
        ? { ...state, undo: null }
        : state;

    case "banner/dismiss":
      return { ...state, banner: null };

    case "info/dismiss":
      return { ...state, info: null };

    default:
      return state;
  }
}
