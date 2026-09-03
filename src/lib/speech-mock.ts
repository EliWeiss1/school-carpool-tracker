/**
 * A fake Deepgram push-to-talk source, built against the interface a real
 * streaming client would implement.
 *
 * CLAUDE.md is unambiguous: there is no Deepgram key on this machine and there
 * will not be one, and this module must never call Deepgram — no key, no
 * network call, ever. So it contains no `fetch`, no `WebSocket`, nothing that
 * touches a network at all; it fakes the *shape* of a streaming session
 * (connecting -> listening -> a final transcript once released) with
 * `setTimeout`, and hands back one of a small cycling set of canned
 * transcripts.
 *
 * `NEXT_PUBLIC_MOCK_SPEECH=true` selects this over a real implementation. The
 * real one is out of scope here for the same reason this file's tests spy on
 * `fetch`/`WebSocket` and assert they are never touched — nobody should be
 * able to add a real call to this module by accident.
 */

import type { TranscriptAlternative } from "@/lib/api";

export type SpeechStatus = "idle" | "connecting" | "listening" | "processing";

/** What a press-and-release produced. Empty when nothing was heard. */
export interface SpeechResult {
  alternatives: TranscriptAlternative[];
}

export interface SpeechSourceHandlers {
  onStatusChange?(status: SpeechStatus): void;
}

export interface CreateSpeechSourceOptions {
  /** From `deepgram-token`. Unused by the mock — carried so a real
   *  implementation can share this same call shape. */
  token: string;
  keyterms: string[];
  handlers?: SpeechSourceHandlers;
}

/**
 * The seam `announce-screen.tsx` programs against. A future real Deepgram
 * client implements this exact shape; nothing above `speech-mock.ts` needs to
 * change when it lands.
 */
export interface SpeechSource {
  /** Opens the mic. Resolves once actively listening. */
  start(): Promise<void>;
  /** Ends capture. Resolves with whatever was heard — possibly nothing. */
  stop(): Promise<SpeechResult>;
  /** Releases resources immediately with no result — unmount, navigation, abort. */
  cancel(): void;
}

/**
 * Demo utterances, cycled in order. Deliberately drawn from the adversarial
 * roster clusters in `supabase/seed/roster.ts` so a press-and-hold during dev
 * exercises `clear`, `ambiguous`, and (the last entry) `none` tiers without
 * anyone having to type anything.
 */
export const DEMO_SCRIPT: SpeechResult[] = [
  {
    alternatives: [
      { transcript: "Cohen", confidence: 0.93 },
      { transcript: "Kohen", confidence: 0.81 },
    ],
  },
  {
    alternatives: [{ transcript: "Nguyen", confidence: 0.9 }],
  },
  {
    alternatives: [
      { transcript: "Chen", confidence: 0.77 },
      { transcript: "Chan", confidence: 0.69 },
      { transcript: "Chin", confidence: 0.58 },
    ],
  },
  {
    // Nothing on the sample roster sounds like this — it stands in for the
    // "the mic heard something, but nobody on the roster matches" case.
    alternatives: [
      { transcript: "Bartholomew Higginbotham", confidence: 0.31 },
    ],
  },
];

const DEFAULT_CONNECT_DELAY_MS = 250;
const DEFAULT_FINALIZE_DELAY_MS = 300;

export interface MockSpeechSourceOptions extends CreateSpeechSourceOptions {
  /** Overrides the built-in demo utterances. Cycles, then repeats from the start. */
  script?: SpeechResult[];
  /** ms before status moves connecting -> listening. */
  connectDelayMs?: number;
  /** ms before stop() resolves, simulating Deepgram finalizing the utterance. */
  finalizeDelayMs?: number;
}

export function createMockSpeechSource(
  options: MockSpeechSourceOptions,
): SpeechSource {
  const script = options.script ?? DEMO_SCRIPT;
  const connectDelayMs = options.connectDelayMs ?? DEFAULT_CONNECT_DELAY_MS;
  const finalizeDelayMs = options.finalizeDelayMs ?? DEFAULT_FINALIZE_DELAY_MS;

  let status: SpeechStatus = "idle";
  let connectTimer: ReturnType<typeof setTimeout> | null = null;
  let finalizeTimer: ReturnType<typeof setTimeout> | null = null;
  let startPromise: Promise<void> | null = null;
  let finalizePromise: Promise<SpeechResult> | null = null;
  let scriptIndex = 0;

  function setStatus(next: SpeechStatus): void {
    status = next;
    options.handlers?.onStatusChange?.(next);
  }

  function start(): Promise<void> {
    if (status === "listening") return Promise.resolve();
    if (startPromise) return startPromise;

    setStatus("connecting");
    startPromise = new Promise<void>((resolve) => {
      connectTimer = setTimeout(() => {
        connectTimer = null;
        startPromise = null;
        setStatus("listening");
        resolve();
      }, connectDelayMs);
    });
    return startPromise;
  }

  function stop(): Promise<SpeechResult> {
    if (finalizePromise) return finalizePromise;

    if (status === "connecting") {
      // Released before the mic was even open — a tap too short to have
      // captured anything. Cancel the connect and report silence rather than
      // waiting for a "listening" state that was never reached.
      if (connectTimer) clearTimeout(connectTimer);
      connectTimer = null;
      startPromise = null;
      setStatus("idle");
      return Promise.resolve({ alternatives: [] });
    }

    if (status !== "listening") {
      // Idle, or a stray double-release. Nothing new happened.
      return Promise.resolve({ alternatives: [] });
    }

    setStatus("processing");
    finalizePromise = new Promise<SpeechResult>((resolve) => {
      finalizeTimer = setTimeout(() => {
        finalizeTimer = null;
        const result = script[scriptIndex % script.length];
        scriptIndex += 1;
        finalizePromise = null;
        setStatus("idle");
        resolve(result);
      }, finalizeDelayMs);
    });
    return finalizePromise;
  }

  function cancel(): void {
    if (connectTimer) clearTimeout(connectTimer);
    if (finalizeTimer) clearTimeout(finalizeTimer);
    connectTimer = null;
    finalizeTimer = null;
    startPromise = null;
    finalizePromise = null;
    setStatus("idle");
  }

  return { start, stop, cancel };
}
