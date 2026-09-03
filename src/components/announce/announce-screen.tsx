"use client";

import { type FormEvent, useEffect, useReducer, useRef, useState } from "react";

import { CandidateList } from "@/components/announce/candidate-list";
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
  initialAnnounceState,
} from "@/lib/announce-reducer";
import { expiresAt, isFresh } from "@/lib/announce-token";
import { formatRemaining, remainingMs } from "@/lib/announce-undo";
import { ApiError, api } from "@/lib/api";
import { publicEnv } from "@/lib/env";
import { type SpeechSource, createMockSpeechSource } from "@/lib/speech-mock";
import { usePinSession } from "@/lib/use-pin-session";

/** Everything `deepgram-token` handed back, kept until it goes stale. */
interface TokenCache {
  token: string;
  keyterms: string[];
  expiresAtMs: number;
  grade: string;
  classGroup: string;
}

type ErrorActionType = "resolve/error" | "confirm/error" | "undo/error";

/** A press that released before the (async-created) speech source existed. */
interface MicSession {
  source: SpeechSource | null;
  releaseRequested: boolean;
}

export function AnnounceScreen() {
  const session = usePinSession();
  const [state, dispatch] = useReducer(
    announceReducer,
    undefined,
    initialAnnounceState,
  );

  const tokenCacheRef = useRef<TokenCache | null>(null);
  const micSessionRef = useRef<MicSession | null>(null);
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
      dispatch({ type: "undo/expire", studentId: state.undo.studentId });
    }
  }, [state.undo, now]);

  // A press that outlives the component (navigated away mid-listen) must not
  // keep a timer alive or, worse, resolve into a dispatch on an unmounted tree.
  useEffect(() => {
    return () => {
      micSessionRef.current?.source?.cancel();
    };
  }, []);

  function reportError(error: unknown, type: ErrorActionType) {
    const banner =
      error instanceof ApiError
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
      cached.grade === state.filter.grade &&
      cached.classGroup === state.filter.classGroup &&
      isFresh(cached.expiresAtMs, Date.now())
    ) {
      return cached;
    }

    try {
      const response = await api.requestToken({
        ...creds,
        grade: state.filter.grade || undefined,
        classGroup: state.filter.classGroup || undefined,
      });
      const next: TokenCache = {
        token: response.token,
        keyterms: response.keyterms,
        expiresAtMs: expiresAt(Date.now(), response.expiresIn),
        grade: state.filter.grade,
        classGroup: state.filter.classGroup,
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
        grade: state.filter.grade || undefined,
        classGroup: state.filter.classGroup || undefined,
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
    if (!tokenInfo) {
      if (micSessionRef.current === mic) micSessionRef.current = null;
      dispatch({ type: "mic/status", status: "idle" });
      return;
    }

    const source = createMockSpeechSource({
      token: tokenInfo.token,
      keyterms: tokenInfo.keyterms,
      handlers: {
        onStatusChange: (status) => dispatch({ type: "mic/status", status }),
      },
    });
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

  async function handleConfirm(candidate: ResolveCandidateLike) {
    const creds = session.credentials();
    if (!creds || state.confirmingId) return;

    const { student, score } = candidate;
    const displayName = `${student.first_name} ${student.last_name}`;
    dispatch({ type: "confirm/start", studentId: student.id });

    try {
      const response = await api.setStatus({
        ...creds,
        studentId: student.id,
        status: "arrived",
        source: state.results?.origin === "voice" ? "voice" : "manual",
        matchConfidence: score,
        transcript: state.results?.transcript,
      });
      dispatch({
        type: "confirm/settled",
        studentId: student.id,
        displayName,
        changed: response.changed,
        logged: response.logged,
        confirmedAt: Date.now(),
      });
    } catch (error) {
      if (isPinError(error)) {
        session.lock();
        return;
      }
      reportError(error, "confirm/error");
    }
  }

  async function handleUndo() {
    const creds = session.credentials();
    if (!creds || !state.undo) return;

    const { studentId } = state.undo;
    dispatch({ type: "undo/start" });
    setUndoPending(true);
    try {
      await api.setStatus({
        ...creds,
        studentId,
        status: "waiting",
        source: "manual",
      });
      dispatch({ type: "undo/success" });
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
  const speechDisabledReason = publicEnv.mockSpeech
    ? undefined
    : "Voice capture is not set up on this device. Use the search above.";

  return (
    <main className="flex min-h-screen flex-col bg-curb-50">
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

      <div className="flex-1 overflow-y-auto px-4 pb-6 pt-4 sm:px-6">
        <div className="mx-auto flex w-full max-w-md flex-col gap-4">
          {state.banner && (
            <ErrorBanner
              tone={state.banner.tone}
              message={state.banner.message}
            />
          )}

          {showUndo && state.undo && (
            <UndoBanner
              displayName={state.undo.displayName}
              remainingLabel={formatRemaining(undoRemaining)}
              pending={undoPending}
              onUndo={handleUndo}
            />
          )}

          {!state.banner && state.info && (
            <p
              role="status"
              aria-live="polite"
              className="rounded-xl bg-white px-4 py-3 text-curb-700 shadow-card"
            >
              {state.info}
            </p>
          )}

          <RosterFilter
            value={state.filter}
            onChange={(field, value) =>
              dispatch({ type: "filter/change", field, value })
            }
          />

          {state.resolving && (
            <LoadingState label="Matching the name…" rows={2} />
          )}

          {!state.resolving &&
            state.results &&
            state.results.tier !== "none" && (
              <CandidateList
                results={state.results}
                confirmingId={state.confirmingId}
                onConfirm={handleConfirm}
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
                hint="Hold the button below and say the last name, or type it below."
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

      <div
        className="sticky bottom-0 z-10 border-t border-curb-200 bg-curb-50/95 px-4 pt-4 backdrop-blur supports-[backdrop-filter]:bg-curb-50/80"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
      >
        <PushToTalkButton
          status={state.micStatus}
          disabledReason={speechDisabledReason}
          onPressStart={() => void handleMicPressStart()}
          onPressEnd={() => void handleMicPressEnd()}
        />
      </div>
    </main>
  );
}
