import { describe, expect, it, vi } from "vitest";

import {
  buildAnnouncement,
  createBrowserSpeechEngine,
  createVoiceAnnouncer,
  UNLOCK_PHRASE,
  type SpeakResult,
  type SpeechEngine,
  type SpokenStudent,
} from "./display-voice";

const maya: SpokenStudent = { id: "1", first_name: "Maya", last_name: "Cohen" };
const aaron: SpokenStudent = { id: "2", first_name: "Aaron", last_name: "Cohen" };
const rivka: SpokenStudent = { id: "3", first_name: "Rivka", last_name: "Levy" };

function fakeEngine(result: SpeakResult = "spoken") {
  const spoken: string[] = [];
  const engine: SpeechEngine & { cancels: number } = {
    cancels: 0,
    speak: vi.fn(async (text: string) => {
      spoken.push(text);
      return result;
    }),
    cancel() {
      engine.cancels += 1;
    },
  };
  return { engine, spoken };
}

/** Runs scheduled callbacks only when `flush()` is called, so the delay is observable. */
function manualSchedule() {
  const queue: Array<{ run: () => void; cancelled: boolean }> = [];
  return {
    schedule(run: () => void) {
      const entry = { run, cancelled: false };
      queue.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    async flush() {
      for (const entry of queue.splice(0)) if (!entry.cancelled) entry.run();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe("buildAnnouncement", () => {
  it("reads each child as first name then last name, one sentence each", () => {
    expect(buildAnnouncement([maya, aaron])).toBe("Maya Cohen. Aaron Cohen.");
  });

  it("trims stray whitespace and skips a blank name", () => {
    expect(
      buildAnnouncement([
        { id: "x", first_name: "  Noa ", last_name: " Koen  " },
        { id: "y", first_name: " ", last_name: "" },
      ]),
    ).toBe("Noa Koen.");
  });
});

describe("createVoiceAnnouncer", () => {
  it("speaks a whole batch as one utterance, after the delay", async () => {
    const { engine, spoken } = fakeEngine();
    const timer = manualSchedule();
    const voice = createVoiceAnnouncer({
      engine,
      repeatWindowMs: 5000,
      delayMs: 700,
      schedule: timer.schedule,
    });

    expect(voice.announce([maya, aaron, rivka])).toBe(
      "Maya Cohen. Aaron Cohen. Rivka Levy.",
    );
    expect(spoken).toEqual([]);

    await timer.flush();
    expect(spoken).toEqual(["Maya Cohen. Aaron Cohen. Rivka Levy."]);
  });

  it("does not repeat a child inside the window, and does after it", async () => {
    let clock = 0;
    const { engine, spoken } = fakeEngine();
    const timer = manualSchedule();
    const voice = createVoiceAnnouncer({
      engine,
      repeatWindowMs: 5000,
      delayMs: 0,
      now: () => clock,
      schedule: timer.schedule,
    });

    voice.announce([maya]);
    // The same arrival again -- a redelivered payload or strict mode's
    // second run of the state updater.
    expect(voice.announce([maya])).toBeNull();
    // A new child in the same batch as a repeat is still spoken, alone.
    clock = 1000;
    expect(voice.announce([maya, aaron])).toBe("Aaron Cohen.");

    clock = 5000;
    expect(voice.announce([maya])).toBe("Maya Cohen.");

    await timer.flush();
    expect(spoken).toEqual(["Maya Cohen.", "Aaron Cohen.", "Maya Cohen."]);
  });

  it("stop() cancels speech that has not started yet", async () => {
    const { engine, spoken } = fakeEngine();
    const timer = manualSchedule();
    const voice = createVoiceAnnouncer({
      engine,
      repeatWindowMs: 5000,
      delayMs: 700,
      schedule: timer.schedule,
    });

    voice.announce([maya]);
    voice.stop();
    await timer.flush();

    expect(spoken).toEqual([]);
    expect(engine.cancels).toBe(1);
  });

  it("reports a blocked browser, and clears it once speech works", async () => {
    const onBlocked = vi.fn();
    const onSpoken = vi.fn();
    const blocked = fakeEngine("blocked");
    const timer = manualSchedule();
    const voice = createVoiceAnnouncer({
      engine: blocked.engine,
      repeatWindowMs: 5000,
      delayMs: 0,
      schedule: timer.schedule,
      onBlocked,
      onSpoken,
    });

    voice.announce([maya]);
    await timer.flush();
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(onSpoken).not.toHaveBeenCalled();

    const working = fakeEngine("spoken");
    const unlocked = createVoiceAnnouncer({
      engine: working.engine,
      repeatWindowMs: 5000,
      delayMs: 0,
      onSpoken,
    });
    expect(await unlocked.unlock()).toBe("spoken");
    expect(working.spoken).toEqual([UNLOCK_PHRASE]);
    expect(onSpoken).toHaveBeenCalledTimes(1);
  });

  it("is a quiet no-op with no speech engine", async () => {
    const voice = createVoiceAnnouncer({
      engine: null,
      repeatWindowMs: 5000,
      delayMs: 0,
    });

    expect(voice.supported).toBe(false);
    expect(voice.announce([maya])).toBeNull();
    expect(await voice.unlock()).toBe("failed");
    expect(() => voice.stop()).not.toThrow();
  });
});

describe("createBrowserSpeechEngine", () => {
  it("returns null where there is no speechSynthesis (Vitest's node env)", () => {
    expect(createBrowserSpeechEngine()).toBeNull();
  });
});
