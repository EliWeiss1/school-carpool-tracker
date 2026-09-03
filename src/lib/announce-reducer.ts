/**
 * The state machine behind `/announce`, as a pure reducer.
 *
 * `announce-screen.tsx` does the I/O — calling `api.ts`, driving the mock (or,
 * one day, real) speech source, ticking a clock for the undo countdown — and
 * dispatches an action for every outcome. This file only decides what the
 * screen looks like *after* that outcome, which is the part CLAUDE.md asks to
 * be tested without rendering anything: every branch here is covered by
 * `announce-reducer.test.ts` with no DOM, no network and no timers.
 *
 * A few rules worth calling out because they encode requirements from
 * CLAUDE.md rather than being arbitrary:
 * - A transcription never auto-writes a status change, so nothing in here
 *   ever produces a "confirmed" state except in direct response to a
 *   `set-status` result the caller already received.
 * - `changed: false` is reported calmly (`info`), never as a `banner` — it is
 *   not a failure, someone else just got there first.
 * - `logged: false` is a quiet `warning`-tone banner and never touches
 *   `undo` — the status change itself is never in question.
 * - `undo/expire` carries the `studentId` it is expiring so a stale timer
 *   from a superseded confirmation can never clobber a newer one.
 */

import type { CandidateStudent, MatchTier, MatchedVia } from "@/lib/api";
import type { SpeechStatus } from "@/lib/speech-mock";

/** Structurally identical to `ResolveCandidate` from `api.ts` — redeclared so
 *  this module (and its tests) do not have to import React-adjacent wiring. */
export interface ResolveCandidateLike {
  student: CandidateStudent;
  score: number;
  matchedOn: string;
  matchedVia: MatchedVia;
}

export type ResolveOrigin = "voice" | "manual";

export interface AnnounceFilter {
  grade: string;
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
  studentId: string;
  displayName: string;
  /** `Date.now()` when `set-status` reported `changed: true`. */
  confirmedAt: number;
}

export interface AnnounceState {
  filter: AnnounceFilter;
  searchText: string;
  micStatus: SpeechStatus;
  resolving: boolean;
  results: AnnounceResults | null;
  /** The studentId currently mid-flight through `set-status`, if any. */
  confirmingId: string | null;
  banner: AnnounceBanner | null;
  /** A calm, non-error message: "already arrived", "nothing heard", etc. */
  info: string | null;
  undo: UndoState | null;
}

export function initialAnnounceState(): AnnounceState {
  return {
    filter: { grade: "", classGroup: "" },
    searchText: "",
    micStatus: "idle",
    resolving: false,
    results: null,
    confirmingId: null,
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
  | { type: "confirm/start"; studentId: string }
  | {
      type: "confirm/settled";
      studentId: string;
      displayName: string;
      changed: boolean;
      logged: boolean;
      confirmedAt: number;
    }
  | { type: "confirm/error"; banner: AnnounceBanner }
  | { type: "undo/start" }
  | { type: "undo/success" }
  | { type: "undo/error"; banner: AnnounceBanner }
  | { type: "undo/expire"; studentId: string }
  | { type: "banner/dismiss" }
  | { type: "info/dismiss" };

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
        banner: action.banner,
      };

    case "confirm/start":
      return { ...state, confirmingId: action.studentId, banner: null };

    case "confirm/settled": {
      const settled: AnnounceState = {
        ...state,
        confirmingId: null,
        results: null,
      };

      if (!action.changed) {
        // Somebody else already confirmed this child. True and calm, not an
        // error — and no new undo window, because nothing changed here.
        return {
          ...settled,
          info: `${action.displayName} was already marked arrived.`,
        };
      }

      const undo: UndoState = {
        studentId: action.studentId,
        displayName: action.displayName,
        confirmedAt: action.confirmedAt,
      };

      if (!action.logged) {
        // The status change stands regardless — see status.ts — so the undo
        // window is real. Only the audit row is missing, surfaced quietly.
        return {
          ...settled,
          undo,
          banner: {
            tone: "warning",
            message: `${action.displayName} is marked arrived, but the confirmation was not logged.`,
          },
        };
      }

      return {
        ...settled,
        undo,
        info: `${action.displayName} is marked arrived.`,
      };
    }

    case "confirm/error":
      return { ...state, confirmingId: null, banner: action.banner };

    case "undo/start":
      return { ...state, banner: null };

    case "undo/success":
      return {
        ...state,
        undo: null,
        info: state.undo
          ? `Undo confirmed — ${state.undo.displayName} is back to waiting.`
          : "Undo confirmed.",
      };

    case "undo/error":
      return { ...state, banner: action.banner };

    case "undo/expire":
      // Only clear the window if it still belongs to the student the timer
      // was set for — a stale timer must never clobber a newer confirmation.
      return state.undo?.studentId === action.studentId
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
