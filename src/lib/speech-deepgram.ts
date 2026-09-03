/**
 * The real Deepgram push-to-talk source -- the seam `speech-mock.ts`
 * documents ("a real Deepgram client will later fulfil" the `SpeechSource`
 * interface). This is that client: mic -> 16kHz mono PCM -> Deepgram's
 * live-streaming WebSocket -> a final transcript once `stop()` is called.
 *
 * Audio capture goes through Web Audio (`ScriptProcessorNode`) rather than
 * `MediaRecorder`, because MediaRecorder's output format differs by browser
 * (webm/opus on Chrome and Android, a not-reliably-chunk-streamable mp4 on
 * Safari/iOS) and this app runs on both. Raw PCM has no container to
 * disagree about, so one code path covers every device staff actually carry.
 *
 * `WebSocket`, `getUserMedia`, and the audio-capture pipeline are all
 * injectable (real browser APIs by default), the same seam
 * `_shared/deepgram.ts` uses for `fetch` -- so the whole state machine is
 * unit-testable with fakes and no real mic or network.
 *
 * Every `start()`/`stop()` cycle is tagged with a `sessionId`. A rapid
 * double-press (release, then press again before Deepgram has finished
 * finalizing the first press) is reachable from `announce-screen.tsx` --
 * `handleMicPressEnd` clears its press-guard before awaiting `stop()` -- so
 * two sessions can legitimately overlap in flight. `sessionId` is what keeps
 * a superseded session's late timer, socket event, or connect attempt from
 * ever touching the session that replaced it.
 */

import type { TranscriptAlternative } from "@/lib/api";
import { downsampleTo16kHz, float32ToInt16PCM } from "@/lib/audio-resample";
import type {
  CreateSpeechSourceOptions,
  SpeechResult,
  SpeechSource,
  SpeechStatus,
} from "@/lib/speech-mock";

const DEEPGRAM_LISTEN_URL = "wss://api.deepgram.com/v1/listen";
const TARGET_SAMPLE_RATE = 16000;
const DEFAULT_FINALIZE_TIMEOUT_MS = 2000;
const CONNECT_TIMEOUT_MS = 8000;
const MAX_ALTERNATIVES = 3;
/** A ScriptProcessorNode buffer size Web Audio accepts (power of two). */
const PROCESSOR_BUFFER_SIZE = 4096;

/**
 * The WHATWG-fixed `readyState` values, kept as local constants rather than
 * read off the global `WebSocket` class -- so this module never depends on
 * that global existing (a test's fake socket, or an older runtime).
 */
const WS_OPEN = 1;
const WS_CLOSED = 3;

/**
 * `deepgram-token` hands this exact string back when the `MOCK_SPEECH`
 * Supabase secret is set (`supabase/functions/_shared/deepgram.ts`,
 * `MOCK_TOKEN`) -- server-side mock mode. That module is Deno-only and not
 * imported here; the literal is small and stable enough to duplicate rather
 * than reach across the app/Edge-Function boundary for it. Seeing it here
 * means `NEXT_PUBLIC_MOCK_SPEECH` (client) and `MOCK_SPEECH` (server) have
 * drifted -- this client is configured for real capture but the server is
 * still handing out fake tokens.
 */
const SERVER_MOCK_TOKEN = "mock-deepgram-token";

/**
 * A speech-source failure with a message that's already safe to render to a
 * staff member verbatim -- `reportError` in `announce-screen.tsx` renders
 * this one's `message` instead of falling back to its generic text, the same
 * way it already does for `ApiError`.
 */
export class SpeechError extends Error {}

/** True when this browser can plausibly run the real client (mic + WebSocket + Web Audio). */
export function isDeepgramSpeechSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  if (typeof navigator.mediaDevices?.getUserMedia !== "function") return false;
  if (typeof WebSocket === "undefined") return false;
  if (typeof window === "undefined") return false;

  return (
    typeof window.AudioContext !== "undefined" ||
    typeof (window as unknown as { webkitAudioContext?: unknown })
      .webkitAudioContext !== "undefined"
  );
}

/**
 * `keyterm` repeats once per roster surname -- Deepgram's documented syntax
 * for Nova-3 Keyterm Prompting. No `punctuate`/`smart_format`: the only thing
 * ever said into this mic is a last name.
 *
 * No `alternatives` param: Deepgram's live-streaming endpoint returns one
 * hypothesis per channel (multi-hypothesis N-best is a pre-recorded-API
 * feature), so unlike the mock's demo script, the real client can only ever
 * hand the resolver a single transcript. `toSpeechResult`'s multi-alternative
 * handling stays as a defensive ceiling, not an active feature, of this path.
 */
export function buildDeepgramListenUrl(keyterms: string[]): string {
  const params = new URLSearchParams({
    model: "nova-3",
    encoding: "linear16",
    sample_rate: String(TARGET_SAMPLE_RATE),
    channels: "1",
  });
  for (const term of keyterms) {
    if (term.trim() !== "") params.append("keyterm", term);
  }
  return `${DEEPGRAM_LISTEN_URL}?${params.toString()}`;
}

/** One audio-capture session: mic -> PCM chunks, until told to stop. */
export interface AudioCapture {
  stop(): void;
}

export type CreateAudioCapture = (
  stream: MediaStream,
  onChunk: (pcm: Int16Array) => void,
) => AudioCapture;

/**
 * Real mic capture: Web Audio + a `ScriptProcessorNode`, downsampled to
 * 16kHz mono PCM as each buffer arrives.
 *
 * `ScriptProcessorNode` is deprecated in favor of `AudioWorkletNode`, but it
 * is the one capture API that behaves the same on Safari/iOS as everywhere
 * else, with no separate worklet module to ship. The main-thread cost that
 * makes it unsuitable for continuous capture doesn't apply to a push-to-talk
 * press lasting a few seconds.
 */
export const createWebAudioCapture: CreateAudioCapture = (stream, onChunk) => {
  const AudioContextCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const context = new AudioContextCtor();

  // Safari can hand back a context that starts (or is later put) in
  // "suspended" state outside of a direct, synchronous gesture handler --
  // and getUserMedia's own await is enough of a gap to trigger that. A
  // suspended context never fires onaudioprocess, which is silent capture:
  // the button reads "listening" but nothing is ever sent.
  if (context.state === "suspended") {
    void context.resume().catch(() => {});
  }

  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);

  processor.onaudioprocess = (event) => {
    // Pathological (real hardware doesn't run below 16kHz), but downsampling
    // throws on an attempted upsample, and a throw inside onaudioprocess is
    // swallowed by the browser -- silent capture again. Skip the buffer
    // instead of ever calling downsample with an impossible ratio.
    if (context.sampleRate < TARGET_SAMPLE_RATE) return;

    const input = event.inputBuffer.getChannelData(0);
    const downsampled = downsampleTo16kHz(
      input,
      context.sampleRate,
      TARGET_SAMPLE_RATE,
    );
    onChunk(float32ToInt16PCM(downsampled));
  };

  // A ScriptProcessorNode only fires while connected through to a
  // destination. Nothing here is meant to be heard -- the mic input isn't
  // routed anywhere but this processor.
  source.connect(processor);
  processor.connect(context.destination);

  return {
    stop() {
      processor.disconnect();
      processor.onaudioprocess = null;
      source.disconnect();
      for (const track of stream.getTracks()) track.stop();
      void context.close().catch(() => {});
    },
  };
};

export interface CreateDeepgramSpeechSourceOptions
  extends CreateSpeechSourceOptions {
  /** ms to wait for a final transcript after CloseStream before giving up. */
  finalizeTimeoutMs?: number;
  /** Test seam. Real browser APIs by default. */
  deps?: {
    getUserMedia?: (
      constraints: MediaStreamConstraints,
    ) => Promise<MediaStream>;
    createWebSocket?: (url: string, protocols: string[]) => WebSocket;
    createAudioCapture?: CreateAudioCapture;
  };
}

/** Narrows a Deepgram `Results` message's `channel.alternatives` without trusting the shape. */
function toSpeechResult(alternatives: unknown): SpeechResult | null {
  if (!Array.isArray(alternatives)) return null;

  const mapped: TranscriptAlternative[] = [];
  for (const alt of alternatives) {
    if (typeof alt !== "object" || alt === null) continue;
    const record = alt as Record<string, unknown>;
    const transcript = record.transcript;
    if (typeof transcript !== "string" || transcript.trim() === "") continue;
    const confidence =
      typeof record.confidence === "number" ? record.confidence : undefined;
    mapped.push({ transcript, confidence });
    if (mapped.length >= MAX_ALTERNATIVES) break;
  }

  return mapped.length > 0 ? { alternatives: mapped } : null;
}

export function createDeepgramSpeechSource(
  options: CreateDeepgramSpeechSourceOptions,
): SpeechSource {
  const finalizeTimeoutMs =
    options.finalizeTimeoutMs ?? DEFAULT_FINALIZE_TIMEOUT_MS;
  const getUserMedia =
    options.deps?.getUserMedia ??
    ((constraints: MediaStreamConstraints) =>
      navigator.mediaDevices.getUserMedia(constraints));
  const createWebSocket =
    options.deps?.createWebSocket ??
    ((url: string, protocols: string[]) => new WebSocket(url, protocols));
  const createAudioCapture =
    options.deps?.createAudioCapture ?? createWebAudioCapture;

  let status: SpeechStatus = "idle";
  /** Bumped on every new start() and every forced end of a session (stop()
   *  while still connecting, or cancel()). Lets a superseded session's own
   *  in-flight work recognize it's been replaced and quietly clean up after
   *  itself instead of touching the session that replaced it. */
  let sessionId = 0;
  let ws: WebSocket | null = null;
  let stream: MediaStream | null = null;
  let capture: AudioCapture | null = null;
  let startPromise: Promise<void> | null = null;
  let stopPromise: Promise<SpeechResult> | null = null;
  let lastFinal: SpeechResult | null = null;
  let finalizeTimer: ReturnType<typeof setTimeout> | null = null;
  let resolveStop: ((result: SpeechResult) => void) | null = null;

  function setStatus(next: SpeechStatus): void {
    if (status === next) return;
    status = next;
    options.handlers?.onStatusChange?.(next);
  }

  /**
   * Releases the mic. Prefers letting the capture pipeline tear itself down
   * (it also stops the stream's tracks) but falls back to stopping the raw
   * stream directly -- cancellation can land before `capture` is ever built
   * (e.g. mid-connect), and the mic must never be left running either way.
   */
  function teardownAudio(): void {
    if (capture) {
      capture.stop();
      capture = null;
    } else if (stream) {
      for (const track of stream.getTracks()) track.stop();
    }
    stream = null;
  }

  function teardownSocket(): void {
    if (ws && ws.readyState !== WS_CLOSED) {
      try {
        ws.close();
      } catch {
        // Already closing/closed -- the goal (stop sending audio) is met either way.
      }
    }
    ws = null;
  }

  function clearFinalizeTimer(): void {
    if (finalizeTimer) clearTimeout(finalizeTimer);
    finalizeTimer = null;
  }

  /**
   * The one place a session actually ends: releases the mic and socket,
   * lands on idle, and -- if anyone is awaiting stop() -- delivers `result`
   * to them. Safe to call even when nothing is pending (resolveStop is then
   * null and the resolve is skipped) and even when nothing was ever built
   * (teardownAudio/teardownSocket are no-ops on null state), so it doubles
   * as both "clean up an aborted start()" and "finish a stop()".
   */
  function endSession(result: SpeechResult): void {
    clearFinalizeTimer();
    const resolve = resolveStop;
    // Nulled before teardownSocket() below, which can synchronously dispatch
    // this same socket's own "close" listener via ws.close() -- that listener
    // also checks `resolveStop` before calling back in here, and finding it
    // already null is what keeps this reentrant without double-resolving.
    // Do not reorder these two lines below teardownSocket().
    resolveStop = null;
    stopPromise = null;
    lastFinal = null;
    teardownAudio();
    teardownSocket();
    setStatus("idle");
    resolve?.(result);
  }

  function handleMessage(id: number, event: MessageEvent): void {
    if (id !== sessionId) return; // a superseded session's listener, firing late

    if (typeof event.data !== "string") return;
    let payload: unknown;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    if (typeof payload !== "object" || payload === null) return;

    const record = payload as Record<string, unknown>;
    if (record.type !== "Results") return;

    const isFinal = record.is_final === true || record.speech_final === true;
    if (!isFinal) return;

    const channel = record.channel as Record<string, unknown> | undefined;
    const result = toSpeechResult(channel?.alternatives);
    if (result) lastFinal = result;

    // Deepgram's own endpointing can finalize a short utterance before the
    // button is even released -- this fires with resolveStop still null in
    // that case, and just remembers `lastFinal` for stop() to pick up later.
    // A "say one last name" press is expected to land in a single final
    // segment; if Deepgram ever splits it, only the last one wins -- a
    // deliberate simplification, not a hidden assumption.
    if (resolveStop) endSession(lastFinal ?? { alternatives: [] });
  }

  function start(): Promise<void> {
    if (options.token === SERVER_MOCK_TOKEN) {
      return Promise.reject(
        new SpeechError(
          "The speech service is still in test mode on the server. Use the typed search instead.",
        ),
      );
    }

    if (status === "listening") return Promise.resolve();
    if (startPromise) return startPromise;

    if (status === "processing") {
      // The previous press is still waiting on Deepgram to finalize and a
      // new press has already begun (release clears the UI's press-guard
      // before awaiting stop()). End it now rather than let its timer or
      // socket outlive it and collide with this session's. Its own caller
      // gets whatever was already known (`lastFinal`) at this exact moment,
      // or silence if nothing had finalized yet -- anything Deepgram would
      // have reported after this point for that press is discarded, not
      // queued. Delivering it late, once this new press is already live,
      // would risk racing the candidate list this new press is about to
      // populate.
      endSession(lastFinal ?? { alternatives: [] });
    }

    const id = ++sessionId;
    setStatus("connecting");

    const attempt = (async () => {
      const media = await getUserMedia({ audio: true });
      if (id !== sessionId) {
        for (const track of media.getTracks()) track.stop();
        return;
      }
      // Assigned to the outer `stream` immediately, before any further
      // await, so teardownAudio() can always find and release it -- even if
      // `capture` (built further down) never gets created.
      stream = media;

      // "bearer", not "token": `options.token` is always a short-lived JWT
      // from Deepgram's /v1/auth/grant (deepgram-token never sends a
      // permanent API key to the browser), and Deepgram authenticates a
      // granted JWT via the Bearer scheme -- "token" is reserved for a
      // permanent API key used directly. Confirmed empirically: connecting
      // with ["token", <granted JWT>] closes immediately (code 1006, no
      // error detail surfaced), while ["bearer", <granted JWT>] opens.
      const socket = createWebSocket(
        buildDeepgramListenUrl(options.keyterms),
        ["bearer", options.token],
      );
      socket.binaryType = "arraybuffer";

      if (id !== sessionId) {
        try {
          socket.close();
        } catch {
          // Never opened -- nothing to clean up on the wire either way.
        }
        for (const track of media.getTracks()) track.stop();
        return;
      }
      ws = socket;

      await new Promise<void>((resolve, reject) => {
        const settle = (outcome: () => void) => {
          clearTimeout(timeout);
          socket.removeEventListener("open", onOpen);
          socket.removeEventListener("error", onFail);
          socket.removeEventListener("close", onFail);
          outcome();
        };
        const onOpen = () => settle(resolve);
        const onFail = () =>
          settle(() =>
            reject(new SpeechError("Could not connect to the speech service.")),
          );
        // A server-initiated close during the handshake (the socket never
        // fires "error", just "close") would otherwise leave this promise
        // pending and the connect timer armed for the full
        // CONNECT_TIMEOUT_MS on a connection that has already ended.
        const timeout = setTimeout(onFail, CONNECT_TIMEOUT_MS);
        socket.addEventListener("open", onOpen);
        socket.addEventListener("error", onFail);
        socket.addEventListener("close", onFail);
      });

      if (id !== sessionId) {
        try {
          socket.close();
        } catch {
          // Best-effort -- we're abandoning this session either way.
        }
        for (const track of media.getTracks()) track.stop();
        return;
      }

      socket.addEventListener("message", (event) => handleMessage(id, event));
      socket.addEventListener("close", () => {
        if (id !== sessionId) return;
        // Only meaningful if we were still waiting on a transcript -- a
        // close that arrives after CloseStream's own finalize path already
        // settled finds resolveStop already null and does nothing.
        if (resolveStop) endSession(lastFinal ?? { alternatives: [] });
      });

      lastFinal = null;
      capture = createAudioCapture(media, (pcm) => {
        if (id === sessionId && socket.readyState === WS_OPEN) {
          socket.send(pcm.buffer);
        }
      });

      setStatus("listening");
    })();

    startPromise = attempt;
    attempt
      .catch(() => {
        // A rejection here is a real failure (getUserMedia denied, the
        // socket errored, the connect timeout fired) -- as opposed to the
        // early `return`s above, which are a quiet, successful handoff to
        // whichever session preempted this one and already did their own
        // cleanup. Only tear down if this is still the current session;
        // otherwise the newer session's resources would be torn down instead.
        if (id === sessionId) endSession({ alternatives: [] });
      })
      .finally(() => {
        if (startPromise === attempt) startPromise = null;
      });

    return attempt;
  }

  function stop(): Promise<SpeechResult> {
    if (stopPromise) return stopPromise;

    if (status === "connecting") {
      // Released before the socket finished opening -- too short a press to
      // have captured anything. Bump the session so the in-flight attempt
      // recognizes it's been superseded, but also tear down directly:
      // getUserMedia may have already resolved and the socket may already
      // exist (assigned to `stream`/`ws` below in start()) even though
      // "connecting" hasn't yet given way to "listening". Waiting for the
      // attempt to notice on its own means waiting up to CONNECT_TIMEOUT_MS
      // with the mic still live.
      sessionId += 1;
      startPromise = null;
      endSession({ alternatives: [] });
      return Promise.resolve({ alternatives: [] });
    }

    if (status !== "listening") {
      return Promise.resolve({ alternatives: [] });
    }

    setStatus("processing");

    // Assigned before anything can possibly settle it -- endSession() below
    // clears `stopPromise` synchronously if it runs inline, and that must
    // land on an already-assigned field, not overwrite a resolved promise
    // back into a pending-looking one.
    const pending = new Promise<SpeechResult>((resolve) => {
      resolveStop = resolve;
    });
    stopPromise = pending;

    // No fast path on an already-present `lastFinal`: Deepgram's endpointing
    // can finalize mid-press on a pause (e.g. "Chen" -- pause -- "no, Chan"),
    // and resolving on that first answer without ever sending CloseStream
    // would lock in a self-correction's wrong half. CloseStream must always
    // flush whatever was said after that point; `lastFinal` (already
    // preserved across it, since it's no longer reset here) is only the
    // fallback if nothing more comes back before the socket closes.
    if (!ws || ws.readyState !== WS_OPEN) {
      endSession({ alternatives: [] });
      return pending;
    }

    // Deepgram's documented flush-and-close control message: finish
    // processing whatever's cached, send the final Results, then close.
    ws.send(JSON.stringify({ type: "CloseStream" }));
    teardownAudio(); // Stop capturing immediately -- the mic indicator should go dark now.

    // A network hiccup can never leave the button reading "Matching..."
    // forever. Tagged with this session's id: if a *new* press has already
    // begun by the time this fires, it belongs to a different session now
    // and must not tear that one down.
    const id = sessionId;
    finalizeTimer = setTimeout(() => {
      if (id === sessionId) endSession(lastFinal ?? { alternatives: [] });
    }, finalizeTimeoutMs);

    return pending;
  }

  function cancel(): void {
    sessionId += 1;
    startPromise = null;
    endSession({ alternatives: [] });
  }

  return { start, stop, cancel };
}
