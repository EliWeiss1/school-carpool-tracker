/**
 * Spoken arrivals for /display: the board reads the names that just arrived
 * ("Maya Cohen. Aaron Cohen.") after the chime, for a teacher who hears the
 * chime but is not looking at the screen.
 *
 * Free and local on purpose: it uses the browser's own `speechSynthesis`, so
 * there is no key, no request and no credit spent per arrival. The trade is
 * that the voice is whatever the device's OS ships, which is why this is an
 * opt-in toggle rather than always on.
 *
 * Split the same way as `display-chime.ts`:
 *
 * - `createVoiceAnnouncer` takes the speech engine, clock and timer as
 *   injectables, so de-duplication and batching are driven by Vitest with no
 *   browser.
 * - `createBrowserSpeechEngine` wraps `window.speechSynthesis` and returns
 *   `null` where there is none (Vitest's node env, an old browser), which is
 *   what lets the board hide the toggle instead of offering a dead control.
 */

/** The slice of a student the voice needs. `Student` satisfies it. */
export interface SpokenStudent {
  id: string;
  first_name: string;
  last_name: string;
}

/**
 * - `spoken`: the browser started (or finished) speaking.
 * - `blocked`: the browser refused because the page has had no click or tap
 *   yet (Chrome's `not-allowed`). The caller should ask for one.
 * - `failed`: anything else, including being cancelled. Not worth surfacing.
 */
export type SpeakResult = "spoken" | "blocked" | "failed";

export interface SpeechEngine {
  speak(text: string): Promise<SpeakResult>;
  /** Drops anything queued or mid-sentence. */
  cancel(): void;
}

/** "Maya Cohen. Aaron Cohen." -- one sentence per child, so the voice pauses between names. */
export function buildAnnouncement(students: readonly SpokenStudent[]): string {
  return students
    .map((student) =>
      `${student.first_name.trim()} ${student.last_name.trim()}`.trim(),
    )
    .filter((name) => name.length > 0)
    .map((name) => `${name}.`)
    .join(" ");
}

/** Said when the toggle is switched on: it is also the click that unlocks speech. */
export const UNLOCK_PHRASE = "Reading names aloud.";

export interface VoiceAnnouncerOptions {
  engine: SpeechEngine | null;
  /**
   * A child already spoken within this window is not spoken again. Covers a
   * realtime payload delivered twice, and React strict mode running the
   * `setRoster` updater (where arrivals are detected) twice in development.
   */
  repeatWindowMs: number;
  /** Wait this long before speaking, so the name does not talk over the chime. */
  delayMs: number;
  /** Called when the browser refuses to speak until the page gets a gesture. */
  onBlocked?: () => void;
  /** Called when speech actually works, so a stale "blocked" prompt can clear. */
  onSpoken?: () => void;
  now?: () => number;
  /** Injectable timer; returns a function that cancels it. */
  schedule?: (run: () => void, delayMs: number) => () => void;
}

export interface VoiceAnnouncer {
  /** Whether this browser can speak at all. */
  readonly supported: boolean;
  /**
   * Queues one utterance for every child in the batch not already spoken
   * recently. Returns the phrase that will be spoken, or `null` for nothing.
   */
  announce(students: readonly SpokenStudent[]): string | null;
  /**
   * Speaks `UNLOCK_PHRASE` right away. Call it from inside a click handler:
   * that click is the user gesture the browser requires before it will speak.
   */
  unlock(): Promise<SpeakResult>;
  /** Silences anything queued or speaking, e.g. when the toggle goes off. */
  stop(): void;
}

function defaultSchedule(run: () => void, delayMs: number): () => void {
  const timer = setTimeout(run, delayMs);
  return () => clearTimeout(timer);
}

export function createVoiceAnnouncer(
  options: VoiceAnnouncerOptions,
): VoiceAnnouncer {
  const { engine } = options;
  const now = options.now ?? (() => Date.now());
  const schedule = options.schedule ?? defaultSchedule;
  const lastSpokenAt = new Map<string, number>();
  const pending = new Set<() => void>();

  function report(result: SpeakResult): SpeakResult {
    if (result === "blocked") options.onBlocked?.();
    if (result === "spoken") options.onSpoken?.();
    return result;
  }

  return {
    supported: engine !== null,

    announce(students) {
      if (!engine) return null;
      const at = now();

      const fresh = students.filter((student) => {
        const previous = lastSpokenAt.get(student.id);
        return previous === undefined || at - previous >= options.repeatWindowMs;
      });
      if (fresh.length === 0) return null;
      for (const student of fresh) lastSpokenAt.set(student.id, at);

      const phrase = buildAnnouncement(fresh);
      if (phrase === "") return null;

      const cancel = schedule(() => {
        pending.delete(cancel);
        void engine.speak(phrase).then(report);
      }, options.delayMs);
      pending.add(cancel);
      return phrase;
    },

    async unlock() {
      if (!engine) return "failed";
      engine.cancel();
      return report(await engine.speak(UNLOCK_PHRASE));
    },

    stop() {
      for (const cancel of pending) cancel();
      pending.clear();
      engine?.cancel();
    },
  };
}

/** A touch slower than default: these are names, heard across a room. */
const SPEECH_RATE = 0.9;

/**
 * Prefers an on-device English voice (no network, nothing to fail at 3pm),
 * then any English voice, then the browser default. Voices load
 * asynchronously in Chrome, so this is asked again on every utterance
 * rather than cached at startup when the list may still be empty.
 */
function pickVoice(
  voices: readonly SpeechSynthesisVoice[],
): SpeechSynthesisVoice | null {
  const english = voices.filter((voice) => voice.lang.toLowerCase().startsWith("en"));
  return (
    english.find((voice) => voice.localService && voice.default) ??
    english.find((voice) => voice.localService) ??
    english[0] ??
    null
  );
}

export function createBrowserSpeechEngine(): SpeechEngine | null {
  if (
    typeof window === "undefined" ||
    !("speechSynthesis" in window) ||
    typeof SpeechSynthesisUtterance === "undefined"
  ) {
    return null;
  }
  const synth = window.speechSynthesis;

  return {
    speak(text) {
      return new Promise<SpeakResult>((resolve) => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = SPEECH_RATE;
        const voice = pickVoice(synth.getVoices());
        if (voice) {
          utterance.voice = voice;
          utterance.lang = voice.lang;
        }
        utterance.onstart = () => resolve("spoken");
        utterance.onend = () => resolve("spoken");
        utterance.onerror = (event) =>
          resolve(event.error === "not-allowed" ? "blocked" : "failed");
        synth.speak(utterance);
      });
    },
    cancel() {
      synth.cancel();
    },
  };
}

/**
 * Whether this page has had a click or tap yet. Speech needs one, so a board
 * reloaded with voice remembered as on can say so up front instead of
 * silently missing the first arrival. `true` where the API is missing:
 * the `blocked` result from a real attempt covers those browsers.
 */
export function pageHasUserGesture(): boolean {
  if (typeof navigator === "undefined") return true;
  const activation = (navigator as Navigator & {
    userActivation?: { hasBeenActive: boolean };
  }).userActivation;
  return activation ? activation.hasBeenActive : true;
}
