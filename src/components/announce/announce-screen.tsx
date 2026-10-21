"use client";

import { type FormEvent, useEffect, useMemo, useReducer, useRef } from "react";

import { AnnounceDock } from "@/components/announce/announce-dock";
import { CandidateList } from "@/components/announce/candidate-list";
import { CarpoolPrompt } from "@/components/announce/carpool-prompt";
import { ClassDrawer } from "@/components/announce/class-drawer";
import { ClassRail } from "@/components/announce/class-rail";
import { RecentAnnouncements } from "@/components/announce/recent-announcements";
import { RosterFilter } from "@/components/announce/roster-filter";
import {
  Button,
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
} from "@/components/ui";
import {
  type AnnounceAction,
  type ResolveCandidateLike,
  announceReducer,
  candidateKey,
  candidateLabel,
  effectiveMemberIds,
  initialAnnounceState,
} from "@/lib/announce-reducer";
import { expiresAt, isFresh } from "@/lib/announce-token";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  type PadStudent,
  announceLabel,
  carpoolMembers,
  promptPicks,
  railClasses,
  scopeKey,
  selectedCountIn,
  selectedIds,
  studentsInClass,
  tapAction,
} from "@/lib/class-roster";
import { publicEnv } from "@/lib/env";
import { buildTypeaheadIndex, suggest } from "@/lib/typeahead";
import { useAnnounceCarpools } from "@/lib/use-announce-carpools";
import { useClassGroups } from "@/lib/use-class-groups";
import { useClassRoster } from "@/lib/use-class-roster";
import {
  SpeechError,
  createDeepgramSpeechSource,
  isDeepgramSpeechSupported,
} from "@/lib/speech-deepgram";
import {
  type SpeechSource,
  type SpeechStatus,
  createMockSpeechSource,
} from "@/lib/speech-mock";
import { useKeyboardBox } from "@/lib/use-keyboard-box";
import { usePinSession } from "@/lib/use-pin-session";

/** Everything `deepgram-token` handed back, kept until it goes stale. */
interface TokenCache {
  token: string;
  keyterms: string[];
  expiresAtMs: number;
  /** `scopeKey` of the classes this token's keyterms were built for. */
  scope: string;
}

/** How a confirm is recorded in `status_events`. */
interface ConfirmAudit {
  source: "voice" | "manual";
  transcript?: string;
}

type ErrorActionType = "resolve/error" | "confirm/error";

/** A press that released before the (async-created) speech source existed. */
interface MicSession {
  source: SpeechSource | null;
  releaseRequested: boolean;
}

export function AnnounceScreen() {
  const session = usePinSession();
  const { names: classGroups } = useClassGroups();
  const classRoster = useClassRoster();
  const keyboard = useKeyboardBox();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [state, dispatch] = useReducer(
    announceReducer,
    undefined,
    initialAnnounceState,
  );
  const narrowedTo = state.filter.classGroups;
  const narrowedScope = scopeKey(narrowedTo);
  const { carpools, ensureLoaded: ensureCarpools } = useAnnounceCarpools(
    session.credentials,
    session.lock,
  );
  // Rebuilt only when the roster or carpool list changes, never per keystroke.
  const typeaheadIndex = useMemo(
    () => buildTypeaheadIndex(classRoster.roster, carpools),
    [classRoster.roster, carpools],
  );

  const tokenCacheRef = useRef<TokenCache | null>(null);
  const micSessionRef = useRef<MicSession | null>(null);
  /**
   * The SpeechSource is a reusable session factory bound to one token, not a
   * single-connection object -- start()/stop() are meant to cycle repeatedly
   * on the same instance (that's why status resets to "idle" at the end of
   * stop()). Recreating it on every press reset a fresh mock's internal
   * rotation to its first entry every time, which is the literal cause of a
   * real reported bug: voice always resolving to the same name no matter
   * what was said. Reuse it for as long as the token is valid; only build a
   * new one when a new token is actually minted.
   */
  const speechSourceRef = useRef<{
    token: string;
    source: SpeechSource;
  } | null>(null);
  // A press that outlives the component (navigated away mid-listen) must not
  // keep a timer alive or, worse, resolve into a dispatch on an unmounted tree.
  const unmountedRef = useRef(false);
  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      speechSourceRef.current?.source.cancel();
    };
  }, []);

  // A new set of matches starts at the top, where the best one is. Otherwise
  // a list scrolled down for the last name keeps its offset and the top
  // suggestions for the next one sit out of view.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [state.results]);

  function reportError(error: unknown, type: ErrorActionType) {
    const banner =
      error instanceof ApiError || error instanceof SpeechError
        ? { tone: "error" as const, message: error.message }
        : {
            tone: "error" as const,
            message: "Something went wrong. Type the name instead.",
          };
    dispatch({ type, banner } as AnnounceAction);
  }

  /** True when the ApiError was a wrong/expired PIN — the gate handles it. */
  function isPinError(error: unknown): error is ApiError {
    return error instanceof ApiError && error.needsPin;
  }

  async function ensureToken(): Promise<TokenCache | null> {
    const creds = session.credentials();
    if (!creds) return null; // PinGate should make this unreachable

    const cached = tokenCacheRef.current;
    if (
      cached &&
      cached.scope === narrowedScope &&
      isFresh(cached.expiresAtMs, Date.now())
    ) {
      return cached;
    }

    try {
      const response = await api.requestToken({
        ...creds,
        classGroups: narrowedTo,
      });
      const next: TokenCache = {
        token: response.token,
        keyterms: response.keyterms,
        expiresAtMs: expiresAt(Date.now(), response.expiresIn),
        scope: narrowedScope,
      };
      tokenCacheRef.current = next;
      return next;
    } catch (error) {
      if (isPinError(error)) {
        session.lock();
        return null;
      }
      reportError(error, "resolve/error");
      return null;
    }
  }

  async function runResolve(
    input:
      | { transcript: string }
      | { alternatives: { transcript: string; confidence?: number }[] },
    origin: "voice" | "manual",
  ) {
    const creds = session.credentials();
    if (!creds) return;

    dispatch({ type: "resolve/start" });
    try {
      const response = await api.resolveName({
        ...creds,
        ...input,
        classGroups: narrowedTo,
      });
      dispatch({
        type: "resolve/success",
        origin,
        tier: response.tier,
        transcript: response.transcript,
        candidates: response.candidates,
      });
    } catch (error) {
      if (isPinError(error)) {
        session.lock();
        return;
      }
      reportError(error, "resolve/error");
    }
  }

  /**
   * Returns the one SpeechSource for this token, building it (mock or real,
   * per NEXT_PUBLIC_MOCK_SPEECH) only when the token actually changed --
   * never on every press. See the comment on speechSourceRef above.
   */
  function getSpeechSource(tokenInfo: TokenCache): SpeechSource {
    const cached = speechSourceRef.current;
    if (cached && cached.token === tokenInfo.token) return cached.source;

    cached?.source.cancel();

    const handlers = {
      onStatusChange: (status: SpeechStatus) =>
        dispatch({ type: "mic/status", status }),
    };
    const source = publicEnv.mockSpeech
      ? createMockSpeechSource({
          token: tokenInfo.token,
          keyterms: tokenInfo.keyterms,
          handlers,
        })
      : createDeepgramSpeechSource({
          token: tokenInfo.token,
          keyterms: tokenInfo.keyterms,
          handlers,
        });

    speechSourceRef.current = { token: tokenInfo.token, source };
    return source;
  }

  async function finishMicRelease(source: SpeechSource) {
    try {
      const result = await source.stop();
      if (result.alternatives.length === 0) {
        dispatch({ type: "mic/nothingHeard" });
        return;
      }
      await runResolve({ alternatives: result.alternatives }, "voice");
    } catch (error) {
      dispatch({ type: "mic/status", status: "idle" });
      reportError(error, "resolve/error");
    }
  }

  async function handleMicPressStart() {
    if (micSessionRef.current) return; // duplicate pointerdown (e.g. a second finger)

    const mic: MicSession = { source: null, releaseRequested: false };
    micSessionRef.current = mic;
    dispatch({ type: "mic/status", status: "connecting" });

    const tokenInfo = await ensureToken();
    // The component can unmount during this await (token fetch is a real
    // network round trip). speechSourceRef is only populated by
    // getSpeechSource() below, so before that point the unmount cleanup
    // effect has nothing to cancel -- bail out here rather than open the mic
    // on a component that's already gone.
    if (unmountedRef.current) return;
    if (!tokenInfo) {
      if (micSessionRef.current === mic) micSessionRef.current = null;
      dispatch({ type: "mic/status", status: "idle" });
      return;
    }

    const source = getSpeechSource(tokenInfo);
    mic.source = source;

    if (mic.releaseRequested) {
      micSessionRef.current = null;
      await finishMicRelease(source);
      return;
    }

    try {
      await source.start();
    } catch (error) {
      micSessionRef.current = null;
      dispatch({ type: "mic/status", status: "idle" });
      reportError(error, "resolve/error");
    }
  }

  async function handleMicPressEnd() {
    const mic = micSessionRef.current;
    if (!mic) return;

    if (!mic.source) {
      // Still waiting on the token — finish the release once it lands.
      mic.releaseRequested = true;
      return;
    }

    micSessionRef.current = null;
    await finishMicRelease(mic.source);
  }

  function handleSearchChange(value: string) {
    ensureCarpools();
    dispatch({
      type: "search/change",
      value,
      suggestions: suggest(typeaheadIndex, value, narrowedTo),
    });
  }

  // Keeps typed suggestions current when what they are drawn from changes
  // under them: the carpool names landing after the first keystroke, a roster
  // refresh, or the class narrowing (which clears results). An answer from
  // resolve-name (voice or Search) on screen is left alone.
  const searchText = state.searchText;
  const showingResolved = state.results !== null && !state.results.live;
  useEffect(() => {
    if (searchText.trim() === "" || showingResolved) return;
    dispatch({
      type: "search/change",
      value: searchText,
      suggestions: suggest(typeaheadIndex, searchText, narrowedTo),
    });
    // searchText is deliberately absent: a keystroke already dispatched its
    // own suggestions in handleSearchChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeaheadIndex, narrowedScope]);

  function handleSearchSubmit(event: FormEvent) {
    event.preventDefault();
    const transcript = state.searchText.trim();
    if (transcript === "") return;
    void runResolve({ transcript }, "manual");
  }

  /**
   * The one write shared by a single-tap confirm, a multi-select confirm and
   * the class drawer. `audit` says how it is recorded; it defaults to whatever
   * the current search result was (voice or typed), which is wrong for the
   * drawer -- a stale voice result must never be logged against names that
   * were tapped by hand -- so the drawer passes its own.
   */
  async function confirmCandidates(
    key: string,
    studentIds: string[],
    displayName: string,
    carpoolId: string | null,
    score: number | null,
    audit: ConfirmAudit = {
      source: state.results?.origin === "voice" ? "voice" : "manual",
      transcript: state.results?.transcript,
    },
  ) {
    const creds = session.credentials();
    if (!creds || state.confirmingKey) return;

    dispatch({ type: "confirm/start", key });

    try {
      const response = await api.setStatus({
        ...creds,
        studentIds,
        status: "arrived",
        source: audit.source,
        matchConfidence: score,
        transcript: audit.transcript,
        carpoolId,
      });
      dispatch({
        type: "confirm/settled",
        studentIds,
        changedIds: response.changed,
        displayName,
        logged: response.logged,
      });
      void classRoster.refresh();
    } catch (error) {
      if (isPinError(error)) {
        session.lock();
        return;
      }
      reportError(error, "confirm/error");
    }
  }

  function handleConfirm(candidate: ResolveCandidateLike) {
    void confirmCandidates(
      candidateKey(candidate),
      effectiveMemberIds(candidate, state.excludedMemberIds),
      candidateLabel(candidate),
      candidate.carpool?.id ?? null,
      candidate.score,
    );
  }

  function handleConfirmSelected() {
    if (!state.results || state.selectedKeys.length === 0) return;

    const selected = state.results.candidates.filter((candidate) =>
      state.selectedKeys.includes(candidateKey(candidate)),
    );
    // A carpool exclusion only ever removes ids from ITS candidate's own
    // contribution here -- it never changes which candidates are selected,
    // so this is a straightforward per-candidate substitution.
    const studentIds = selected.flatMap((candidate) =>
      effectiveMemberIds(candidate, state.excludedMemberIds),
    );
    const displayName = selected.map(candidateLabel).join(", ");
    // Only meaningful to attribute this confirm to a single carpool when
    // exactly one carpool (and nothing else) was selected -- a mixed batch of
    // several unrelated candidates has no one carpool to log against.
    const carpoolId =
      selected.length === 1 ? (selected[0].carpool?.id ?? null) : null;
    const score = selected.length === 1 ? selected[0].score : null;

    void confirmCandidates("multi", studentIds, displayName, carpoolId, score);
  }

  /** The class drawer's one write: every name picked, across classes, at once. */
  function handleAnnouncePicked() {
    const ids = selectedIds(state.pad.selection);
    if (ids.length === 0) return;

    void confirmCandidates(
      "pad",
      ids,
      announceLabel(classRoster.roster, ids),
      null,
      null,
      // Tapped by hand: never voice, and no transcript to attach.
      { source: "manual" },
    );
  }

  /**
   * The reverse of announcing: a green name tapped in the drawer goes back to
   * waiting. There is deliberately no timed undo banner -- this is the one way
   * to take an announcement back, available any time, for any student.
   */
  async function handleUnannounce(student: PadStudent) {
    const creds = session.credentials();
    if (!creds || state.confirmingKey) return;

    dispatch({ type: "confirm/start", key: `unannounce:${student.id}` });

    try {
      await api.setStatus({
        ...creds,
        studentIds: [student.id],
        status: "waiting",
        source: "manual",
      });
      dispatch({
        type: "unannounce/settled",
        studentId: student.id,
        displayName: `${student.first_name} ${student.last_name}`,
      });
      void classRoster.refresh();
    } catch (error) {
      if (isPinError(error)) {
        session.lock();
        return;
      }
      reportError(error, "confirm/error");
    }
  }

  /** Routes a tap on a name in the drawer; the rules live in `tapAction`. */
  function handleTapStudent(student: PadStudent) {
    const action = tapAction(classRoster.roster, state.pad.selection, student);
    const classGroup = student.class_group ?? "";

    switch (action) {
      case "unannounce":
        void handleUnannounce(student);
        return;
      case "prompt":
        dispatch({ type: "pad/promptCarpool", studentId: student.id });
        return;
      case "select":
      case "deselect":
        dispatch({
          type: "pad/toggleStudent",
          classGroup,
          studentId: student.id,
        });
        return;
    }
  }

  // Mock mode needs no real capability check. Otherwise this reflects what
  // the browser can actually do, not which speech backend is configured --
  // a real Deepgram client now backs this, so "disabled" should mean "this
  // device/browser can't do it" (no mic API, no WebSocket), not "voice was
  // never wired up."
  const speechDisabledReason =
    publicEnv.mockSpeech || isDeepgramSpeechSupported()
      ? undefined
      : "Voice capture isn't available on this device or browser. Type the name instead.";

  const railList = railClasses(classGroups, narrowedTo);
  const openClass = state.pad.openClass;
  const pickedTotal = selectedIds(state.pad.selection).length;
  // The rail steps aside while matches are on screen, so the candidates get
  // the full width -- unless the drawer is open or picks are waiting in it,
  // since its badges are what keep an unsent pick from being forgotten.
  const railVisible =
    railList.length > 0 &&
    (state.results === null || openClass !== null || pickedTotal > 0);
  const recentStudents = useMemo(() => {
    const byId = new Map(classRoster.roster.map((s) => [s.id, s]));
    return state.recentIds.flatMap((id) => byId.get(id) ?? []);
  }, [classRoster.roster, state.recentIds]);
  const promptStudent = state.pad.carpoolPrompt
    ? classRoster.roster.find(
        (s) => s.id === state.pad.carpoolPrompt?.studentId,
      )
    : undefined;
  const promptMembers = useMemo(
    () =>
      promptStudent ? carpoolMembers(classRoster.roster, promptStudent) : [],
    [classRoster.roster, promptStudent],
  );
  const drawerStudents = useMemo(
    () =>
      openClass === null ? [] : studentsInClass(classRoster.roster, openClass),
    [classRoster.roster, openClass],
  );

  /**
   * Banners and the calm status line. They sit at the top of the page
   * normally, but the drawer covers the top of the page, so while it is open
   * errors render inside it -- an announce must never fail out of sight. The
   * calm line stays out of the drawer: the names turning green is the
   * confirmation, and a sentence there would only take height from the list.
   */
  const renderFeedback = (inDrawer: boolean) => (
    <>
      {state.banner && (
        <ErrorBanner tone={state.banner.tone} message={state.banner.message} />
      )}

      {!inDrawer && !state.banner && state.info && (
        <p
          role="status"
          aria-live="polite"
          className="rounded-xl bg-white px-4 py-3 text-curb-700 shadow-card"
        >
          {state.info}
        </p>
      )}
    </>
  );

  return (
    // h-dvh (not min-h-screen) so the header and the dock stay put and the
    // middle scrolls: the rail and drawer are positioned against that middle,
    // and dvh tracks the collapsing address bar on iOS Safari and Android
    // Chrome, where plain vh leaves the dock hidden underneath it.
    //
    // Top to bottom: a one-line header (class filter + Lock), the matches,
    // then the dock (search + mic). Everything that produces names sits at
    // the bottom under the thumb, so the space between is all names.
    //
    // While an iOS keyboard is open the screen is pinned to the area above it
    // (`keyboard`), since Safari won't shrink the layout the way Android does.
    <main
      className="flex h-screen flex-col bg-curb-50 supports-[height:100dvh]:h-dvh"
      style={
        keyboard
          ? {
              position: "fixed",
              left: 0,
              right: 0,
              top: keyboard.top,
              height: keyboard.height,
            }
          : undefined
      }
    >
      <PageHeader
        dense
        eyebrow="Lane 01 · Outside"
        title="Announce"
        live={state.micStatus === "listening"}
        action={
          <div className="flex shrink-0 items-center gap-1">
            <RosterFilter
              classGroups={classGroups}
              narrowedTo={narrowedTo}
              onToggle={(classGroup) =>
                dispatch({ type: "filter/toggleClass", classGroup })
              }
              onClear={() => dispatch({ type: "filter/clear" })}
            />
            <Button
              variant="quiet-ink"
              size="md"
              className="!px-3"
              onClick={() => session.lock()}
            >
              Lock
            </Button>
          </div>
        }
      />

      <div className="relative mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col">
        <div
          ref={scrollRef}
          className={cn(
            "min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain pb-6 pl-4 pt-4",
            // Leaves room for the rail so no candidate button slides under it.
            railVisible ? "pr-16" : "pr-4",
          )}
        >
          <div className="flex w-full flex-col gap-4">
            {openClass === null && renderFeedback(false)}

            {state.resolving && (
              <LoadingState label="Matching the name…" rows={2} />
            )}

            {!state.resolving &&
              state.results &&
              state.results.tier !== "none" && (
                <CandidateList
                  results={state.results}
                  confirmingKey={state.confirmingKey}
                  multiSelect={state.multiSelect}
                  selectedKeys={state.selectedKeys}
                  excludedMemberIds={state.excludedMemberIds}
                  onConfirm={handleConfirm}
                  onToggleSelect={(key) =>
                    dispatch({ type: "candidate/toggleSelect", key })
                  }
                  onConfirmSelected={handleConfirmSelected}
                  onToggleMultiSelect={() =>
                    dispatch({ type: "multiSelect/toggle" })
                  }
                  onToggleMember={(candidateKey, studentId) =>
                    dispatch({
                      type: "candidate/toggleMember",
                      candidateKey,
                      studentId,
                    })
                  }
                />
              )}

            {!state.resolving &&
              state.results &&
              state.results.tier === "none" && (
                <EmptyState
                  className="py-8"
                  title="No match on the roster"
                  hint={
                    state.results.live
                      ? `No name starts with "${state.results.transcript}". Tap Search to check similar spellings.`
                      : state.results.origin === "manual"
                        ? `Nothing on the roster is close to "${state.results.transcript}." Check the spelling and try again.`
                        : `Heard "${state.results.transcript}." Type the name below instead.`
                  }
                />
              )}

            {!state.resolving && !state.results && (
              <>
                {/* One quiet line, not a card: the controls it describes are
                    right there below it. */}
                {!state.banner && !state.info && (
                  <p className="px-1 text-curb-600">
                    {railVisible
                      ? "Hold the mic and say a last name, type one below, or tap a class on the right."
                      : "Hold the mic and say a last name, or type one below."}
                  </p>
                )}
                <RecentAnnouncements
                  students={recentStudents}
                  busyId={
                    state.confirmingKey?.startsWith("unannounce:")
                      ? state.confirmingKey.slice("unannounce:".length)
                      : null
                  }
                  disabled={state.confirmingKey !== null}
                  onSendBack={(student) => void handleUnannounce(student)}
                />
              </>
            )}
          </div>
        </div>

        {railVisible && (
          <ClassRail
            classes={railList}
            openClass={openClass}
            pickedCount={(classGroup) =>
              selectedCountIn(state.pad.selection, classGroup)
            }
            onSelect={(classGroup) =>
              dispatch(
                classGroup === openClass
                  ? { type: "pad/close" }
                  : { type: "pad/open", classGroup },
              )
            }
          />
        )}

        {openClass !== null && (
          <ClassDrawer
            classGroup={openClass}
            students={drawerStudents}
            pickedIds={state.pad.selection[openClass] ?? []}
            totalPicked={pickedTotal}
            announcing={state.confirmingKey === "pad"}
            busy={state.confirmingKey !== null}
            loading={classRoster.loading}
            error={classRoster.error}
            feedback={state.banner ? renderFeedback(true) : null}
            onTap={handleTapStudent}
            onClear={() => dispatch({ type: "pad/clearSelection" })}
            onAnnounce={handleAnnouncePicked}
            onClose={() => dispatch({ type: "pad/close" })}
            onRetry={() => void classRoster.refresh()}
            prompt={
              promptStudent && state.pad.carpoolPrompt ? (
                <CarpoolPrompt
                  members={promptMembers}
                  unchecked={state.pad.carpoolPrompt.unchecked}
                  onToggle={(studentId) =>
                    dispatch({ type: "pad/promptToggle", studentId })
                  }
                  onConfirm={() =>
                    dispatch({
                      type: "pad/selectMany",
                      picks: promptPicks(
                        promptMembers,
                        state.pad.carpoolPrompt?.unchecked ?? [],
                      ),
                    })
                  }
                  onCancel={() => dispatch({ type: "pad/promptCancel" })}
                />
              ) : null
            }
          />
        )}
      </div>

      <AnnounceDock
        searchText={state.searchText}
        onSearchChange={handleSearchChange}
        onSearchSubmit={handleSearchSubmit}
        // Typing means calling by name, and the drawer would only cover the
        // suggestions. Its picks survive the close, badged on the rail.
        onSearchFocus={() => {
          if (openClass !== null) dispatch({ type: "pad/close" });
        }}
        searchDisabled={state.resolving}
        micStatus={state.micStatus}
        micDisabledReason={speechDisabledReason}
        onMicPressStart={() => void handleMicPressStart()}
        onMicPressEnd={() => void handleMicPressEnd()}
      />
    </main>
  );
}
