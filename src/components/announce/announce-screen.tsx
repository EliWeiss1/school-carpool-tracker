"use client";

import {
  type FormEvent,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import { CandidateList } from "@/components/announce/candidate-list";
import { ClassDrawer } from "@/components/announce/class-drawer";
import { ClassRail } from "@/components/announce/class-rail";
import { PushToTalkButton } from "@/components/announce/push-to-talk-button";
import { RosterFilter } from "@/components/announce/roster-filter";
import { SearchFallback } from "@/components/announce/search-fallback";
import { UndoBanner } from "@/components/announce/undo-banner";
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
import { formatRemaining, remainingMs } from "@/lib/announce-undo";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  announceLabel,
  railClasses,
  scopeKey,
  selectedCountIn,
  selectedIds,
  studentsInClass,
} from "@/lib/class-roster";
import { publicEnv } from "@/lib/env";
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

type ErrorActionType = "resolve/error" | "confirm/error" | "undo/error";

/** A press that released before the (async-created) speech source existed. */
interface MicSession {
  source: SpeechSource | null;
  releaseRequested: boolean;
}

export function AnnounceScreen() {
  const session = usePinSession();
  const { names: classGroups } = useClassGroups();
  const classRoster = useClassRoster();
  const [state, dispatch] = useReducer(
    announceReducer,
    undefined,
    initialAnnounceState,
  );
  const narrowedTo = state.filter.classGroups;
  const narrowedScope = scopeKey(narrowedTo);

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
  const speechSourceRef = useRef<{ token: string; source: SpeechSource } | null>(
    null,
  );
  const [undoPending, setUndoPending] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Ticks once a second only while there is something to count down —
  // /announce otherwise never re-renders on a timer, which matters on the
  // slow hardware this runs on outdoors.
  useEffect(() => {
    if (!state.undo) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state.undo]);

  useEffect(() => {
    if (state.undo && remainingMs(state.undo, now) <= 0) {
      dispatch({ type: "undo/expire", studentIds: state.undo.studentIds });
    }
  }, [state.undo, now]);

  // A press that outlives the component (navigated away mid-listen) must not
  // keep a timer alive or, worse, resolve into a dispatch on an unmounted tree.
  const unmountedRef = useRef(false);
  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      speechSourceRef.current?.source.cancel();
    };
  }, []);

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
        carpoolId,
        logged: response.logged,
        confirmedAt: Date.now(),
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

    void confirmCandidates(
      "multi",
      studentIds,
      displayName,
      carpoolId,
      score,
    );
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

  async function handleUndo() {
    const creds = session.credentials();
    if (!creds || !state.undo) return;

    const { studentIds } = state.undo;
    dispatch({ type: "undo/start" });
    setUndoPending(true);
    try {
      await api.setStatus({
        ...creds,
        studentIds,
        status: "waiting",
        source: "manual",
      });
      dispatch({ type: "undo/success" });
      void classRoster.refresh();
    } catch (error) {
      if (isPinError(error)) {
        session.lock();
        return;
      }
      reportError(error, "undo/error");
    } finally {
      setUndoPending(false);
    }
  }

  const undoRemaining = state.undo ? remainingMs(state.undo, now) : 0;
  const showUndo = state.undo !== null && undoRemaining > 0;
  // Mock mode needs no real capability check. Otherwise this reflects what
  // the browser can actually do, not which speech backend is configured --
  // a real Deepgram client now backs this, so "disabled" should mean "this
  // device/browser can't do it" (no mic API, no WebSocket), not "voice was
  // never wired up."
  const speechDisabledReason =
    publicEnv.mockSpeech || isDeepgramSpeechSupported()
      ? undefined
      : "Voice capture isn't available on this device or browser. Use the search above.";

  const railList = railClasses(classGroups, narrowedTo);
  const railVisible = railList.length > 0;
  const openClass = state.pad.openClass;
  const pickedTotal = selectedIds(state.pad.selection).length;
  const drawerStudents = useMemo(
    () =>
      openClass === null
        ? []
        : studentsInClass(classRoster.roster, openClass),
    [classRoster.roster, openClass],
  );

  /**
   * Banners, the undo window and the calm status line. They sit at the top of
   * the page normally, but the drawer covers the top of the page, so while it
   * is open the same nodes render inside it -- an announce must never succeed
   * (or fail) out of sight.
   */
  const renderFeedback = (inDrawer: boolean) => (
    <>
      {state.banner && (
        <ErrorBanner tone={state.banner.tone} message={state.banner.message} />
      )}

      {showUndo && state.undo && (
        <UndoBanner
          displayName={state.undo.displayName}
          remainingLabel={formatRemaining(undoRemaining)}
          pending={undoPending}
          compact={inDrawer}
          onUndo={handleUndo}
        />
      )}

      {/* The undo banner already says who arrived; repeating it in the cramped
          drawer would push the list off the screen. */}
      {!state.banner && state.info && !(inDrawer && showUndo) && (
        <p
          role="status"
          aria-live="polite"
          className="rounded-xl bg-curb-50 px-4 py-3 text-curb-700"
        >
          {state.info}
        </p>
      )}
    </>
  );

  return (
    // h-dvh (not min-h-screen) so the header and the mic bar stay put and the
    // middle scrolls: the rail and drawer are positioned against that middle,
    // and dvh tracks the collapsing address bar on iOS Safari and Android
    // Chrome, where plain vh leaves the mic button hidden underneath it.
    <main className="flex h-screen flex-col bg-curb-50 supports-[height:100dvh]:h-dvh">
      <PageHeader
        eyebrow="Lane 01 · Outside"
        title="Announce"
        live={state.micStatus === "listening"}
        action={
          <Button variant="quiet-ink" size="sm" onClick={() => session.lock()}>
            Lock
          </Button>
        }
      />

      <div className="relative mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col">
        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6 pl-4 pt-4",
            // Leaves room for the rail so no candidate button slides under it.
            railVisible ? "pr-16" : "pr-4",
          )}
        >
          <div className="flex w-full flex-col gap-4">
            {openClass === null && renderFeedback(false)}

            <RosterFilter
              classGroups={classGroups}
              narrowedTo={narrowedTo}
              onToggle={(classGroup) =>
                dispatch({ type: "filter/toggleClass", classGroup })
              }
              onClear={() => dispatch({ type: "filter/clear" })}
            />

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
                  title="No match on the roster"
                  hint={`Heard "${state.results.transcript}." Type the name below instead.`}
                />
              )}

            {!state.resolving &&
              !state.results &&
              !state.info &&
              !state.banner && (
                <EmptyState
                  title="Ready when you are"
                  hint={
                    railVisible
                      ? "Hold the button below and say the last name, type it, or tap a class on the right to pick names."
                      : "Hold the button below and say the last name, or type it below."
                  }
                />
              )}

            <SearchFallback
              value={state.searchText}
              onChange={(value) => dispatch({ type: "search/change", value })}
              onSubmit={handleSearchSubmit}
              disabled={state.resolving}
            />
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
            announcing={state.confirmingKey !== null}
            loading={classRoster.loading}
            error={classRoster.error}
            feedback={renderFeedback(true)}
            onToggle={(studentId) =>
              dispatch({
                type: "pad/toggleStudent",
                classGroup: openClass,
                studentId,
              })
            }
            onClear={() => dispatch({ type: "pad/clearSelection" })}
            onAnnounce={handleAnnouncePicked}
            onClose={() => dispatch({ type: "pad/close" })}
            onRetry={() => void classRoster.refresh()}
          />
        )}
      </div>

      <div
        className={cn(
          "z-10 border-t border-curb-200 bg-curb-50 px-4",
          openClass === null ? "pt-4" : "pt-3",
        )}
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
      >
        <PushToTalkButton
          status={state.micStatus}
          disabledReason={speechDisabledReason}
          // The drawer needs the height more than the mic needs the size.
          compact={openClass !== null}
          onPressStart={() => void handleMicPressStart()}
          onPressEnd={() => void handleMicPressEnd()}
        />
      </div>
    </main>
  );
}
