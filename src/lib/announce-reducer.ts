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
 * - `logged < changedIds.length` is a quiet `warning`-tone banner — the status
 *   change itself is never in question.
 * - There is no undo window. Sending someone back to waiting is the drawer's
 *   job: tapping a green name there is the reverse of announcing it.
 * - Multi-select is opt-in and defaults off: a tap on a single candidate
 *   confirms it immediately, exactly as it always has. Turning "Announce
 *   several" on is what makes a tap a checkbox instead of a confirm.
 */

import type { CandidateStudent, MatchTier, MatchedVia } from "@/lib/api";
import {
  type PadPick,
  type PadSelection,
  addSelected,
  pruneSelection,
  removeIds,
  toggleSelected,
} from "@/lib/class-roster";
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
  /** Empty means "any class" -- the same default as before multi-class narrowing. */
  classGroups: string[];
}

/**
 * The class drawer: tap students by name instead of speaking or typing.
 * Deliberately separate from `multiSelect`/`selectedKeys`, which pick among
 * *search candidates* -- this picks straight from the roster.
 */
export interface RosterPad {
  /** The class whose drawer is open, or null when it is closed. */
  openClass: string | null;
  /** Survives closing the drawer and switching classes; see `PadSelection`. */
  selection: PadSelection;
  /**
   * Set while the "who is riding?" prompt is up for a tapped student who has
   * carpool-mates. Everyone starts ticked; `unchecked` is who the staff member
   * has since un-ticked. The members themselves are derived from the roster at
   * render time, so this never holds stale names.
   */
  carpoolPrompt: { studentId: string; unchecked: string[] } | null;
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

export interface AnnounceState {
  filter: AnnounceFilter;
  pad: RosterPad;
  searchText: string;
  micStatus: SpeechStatus;
  resolving: boolean;
  results: AnnounceResults | null;
  /** True once "Announce several" is toggled on; tapping a candidate then selects instead of confirming. */
  multiSelect: boolean;
  /** Candidate keys currently checked, only meaningful while multiSelect is on. */
  selectedKeys: string[];
  /**
   * Carpool members toggled OFF for this confirm only -- keyed by
   * `candidateKey(candidate)`, values are student ids from that carpool.
   * Absent key (or an empty array) means "everyone in", the same
   * always-announce-everyone behaviour as before this existed. This is a
   * different concern from `multiSelect`/`selectedKeys`: that toggle picks
   * WHICH candidates get confirmed, this one excludes a member from WITHIN
   * one carpool candidate's own confirm -- e.g. a sibling who isn't riding
   * today.
   */
  excludedMemberIds: Record<string, string[]>;
  /** The candidate key (or "multi") currently mid-flight through `set-status`, if any. */
  confirmingKey: string | null;
  banner: AnnounceBanner | null;
  /** A calm, non-error message: "already arrived", "nothing heard", etc. */
  info: string | null;
}

export function initialAnnounceState(): AnnounceState {
  return {
    filter: { classGroups: [] },
    pad: { openClass: null, selection: {}, carpoolPrompt: null },
    searchText: "",
    micStatus: "idle",
    resolving: false,
    results: null,
    multiSelect: false,
    selectedKeys: [],
    excludedMemberIds: {},
    confirmingKey: null,
    banner: null,
    info: null,
  };
}

/**
 * The member ids a confirm of this candidate should actually send --
 * `candidate.students` filtered against any exclusion the announcer made for
 * this specific carpool. A candidate never touched here returns everyone,
 * exactly as before this feature existed.
 */
export function effectiveMemberIds(
  candidate: ResolveCandidateLike,
  excludedMemberIds: Record<string, string[]>,
): string[] {
  const excluded = new Set(excludedMemberIds[candidateKey(candidate)] ?? []);
  return candidate.students
    .map((student) => student.id)
    .filter((id) => !excluded.has(id));
}

export type AnnounceAction =
  | { type: "filter/toggleClass"; classGroup: string }
  | { type: "filter/clear" }
  | { type: "pad/open"; classGroup: string }
  | { type: "pad/close" }
  | { type: "pad/toggleStudent"; classGroup: string; studentId: string }
  | { type: "pad/clearSelection" }
  | { type: "pad/promptCarpool"; studentId: string }
  | { type: "pad/promptToggle"; studentId: string }
  | { type: "pad/promptCancel" }
  | { type: "pad/selectMany"; picks: PadPick[] }
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
  | { type: "candidate/toggleMember"; candidateKey: string; studentId: string }
  | { type: "confirm/start"; key: string }
  | {
      type: "confirm/settled";
      studentIds: string[];
      changedIds: string[];
      displayName: string;
      logged: number;
    }
  | { type: "confirm/error"; banner: AnnounceBanner }
  | { type: "unannounce/settled"; displayName: string }
  | { type: "banner/dismiss" }
  | { type: "info/dismiss" };

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

/**
 * Applies a new class narrowing. The keyterm list and candidate pool are both
 * scoped by it, so a result matched against the old scope is stale; and the
 * drawer may only show, and keep picks from, classes still on offer.
 */
function narrow(state: AnnounceState, classGroups: string[]): AnnounceState {
  const everyClass = classGroups.length === 0;
  const stillOffered = (name: string) =>
    everyClass || classGroups.includes(name);

  return {
    ...state,
    filter: { classGroups },
    pad: {
      openClass:
        state.pad.openClass !== null && stillOffered(state.pad.openClass)
          ? state.pad.openClass
          : null,
      selection: everyClass
        ? state.pad.selection
        : pruneSelection(state.pad.selection, classGroups),
      carpoolPrompt: null,
    },
    results: null,
    selectedKeys: [],
    excludedMemberIds: {},
  };
}

export function announceReducer(
  state: AnnounceState,
  action: AnnounceAction,
): AnnounceState {
  switch (action.type) {
    case "filter/toggleClass": {
      const isOn = state.filter.classGroups.includes(action.classGroup);
      return narrow(
        state,
        isOn
          ? state.filter.classGroups.filter((name) => name !== action.classGroup)
          : [...state.filter.classGroups, action.classGroup],
      );
    }

    case "filter/clear":
      return narrow(state, []);

    case "pad/open":
      return { ...state, pad: { ...state.pad, openClass: action.classGroup } };

    case "pad/close":
      return {
        ...state,
        pad: { ...state.pad, openClass: null, carpoolPrompt: null },
      };

    case "pad/toggleStudent":
      return {
        ...state,
        pad: {
          ...state.pad,
          selection: toggleSelected(
            state.pad.selection,
            action.classGroup,
            action.studentId,
          ),
        },
      };

    case "pad/clearSelection":
      return { ...state, pad: { ...state.pad, selection: {} } };

    case "pad/promptCarpool":
      return {
        ...state,
        pad: {
          ...state.pad,
          carpoolPrompt: { studentId: action.studentId, unchecked: [] },
        },
      };

    case "pad/promptToggle": {
      const prompt = state.pad.carpoolPrompt;
      if (!prompt) return state;
      const isOff = prompt.unchecked.includes(action.studentId);
      return {
        ...state,
        pad: {
          ...state.pad,
          carpoolPrompt: {
            ...prompt,
            unchecked: isOff
              ? prompt.unchecked.filter((id) => id !== action.studentId)
              : [...prompt.unchecked, action.studentId],
          },
        },
      };
    }

    case "pad/promptCancel":
      return { ...state, pad: { ...state.pad, carpoolPrompt: null } };

    case "pad/selectMany":
      return {
        ...state,
        pad: {
          ...state.pad,
          selection: addSelected(state.pad.selection, action.picks),
          carpoolPrompt: null,
        },
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
        excludedMemberIds: {},
        info: "Didn't catch that. Try again, or type the name below.",
      };

    case "resolve/start":
      return {
        ...state,
        // Results render in the page behind the drawer, so it steps aside.
        // The picks stay: coming back to the drawer should not lose them.
        pad: { ...state.pad, openClass: null, carpoolPrompt: null },
        resolving: true,
        banner: null,
        info: null,
      };

    case "resolve/success":
      return {
        ...state,
        resolving: false,
        selectedKeys: [],
        excludedMemberIds: {},
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
        excludedMemberIds: {},
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

    case "candidate/toggleMember": {
      const current = state.excludedMemberIds[action.candidateKey] ?? [];
      const isExcluded = current.includes(action.studentId);
      const next = isExcluded
        ? current.filter((id) => id !== action.studentId)
        : [...current, action.studentId];

      return {
        ...state,
        excludedMemberIds: {
          ...state.excludedMemberIds,
          [action.candidateKey]: next,
        },
      };
    }

    case "confirm/start":
      return { ...state, confirmingKey: action.key, banner: null };

    case "confirm/settled": {
      const settled: AnnounceState = {
        ...state,
        // Whoever was just announced is no longer a pick, from any source.
        pad: {
          ...state.pad,
          selection: removeIds(state.pad.selection, action.studentIds),
        },
        confirmingKey: null,
        results: null,
        selectedKeys: [],
        excludedMemberIds: {},
      };

      const total = action.studentIds.length;
      const changedCount = action.changedIds.length;
      const subject = pluralize(total, "is", "are");

      if (changedCount === 0) {
        // Somebody else already confirmed everyone here. True and calm, not
        // an error.
        return {
          ...settled,
          info: `${action.displayName} ${pluralize(total, "was", "were")} already marked arrived.`,
        };
      }

      const partial = changedCount < total;
      const baseMessage = partial
        ? `${changedCount} of ${total} in ${action.displayName} ${subject} now arrived (the rest were already).`
        : `${action.displayName} ${subject} marked arrived.`;

      if (action.logged < changedCount) {
        // The status change stands regardless — see status.ts. Only some audit
        // rows are missing, surfaced quietly.
        return {
          ...settled,
          banner: {
            tone: "warning",
            message: `${baseMessage.replace(/\.$/, "")}, but the confirmation was not fully logged.`,
          },
        };
      }

      return { ...settled, info: baseMessage };
    }

    case "confirm/error":
      return { ...state, confirmingKey: null, banner: action.banner };

    case "unannounce/settled":
      return {
        ...state,
        confirmingKey: null,
        info: `${action.displayName} is back to waiting.`,
      };

    case "banner/dismiss":
      return { ...state, banner: null };

    case "info/dismiss":
      return { ...state, info: null };

    default:
      return state;
  }
}
