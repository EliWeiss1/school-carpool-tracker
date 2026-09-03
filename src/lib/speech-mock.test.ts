import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEMO_SCRIPT, createMockSpeechSource } from "./speech-mock";

const BASE_OPTIONS = { token: "mock-deepgram-token", keyterms: ["Cohen"] };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Presses start() and drives the fake clock forward until it settles. */
async function startAndSettle(
  source: ReturnType<typeof createMockSpeechSource>,
  connectDelayMs: number,
): Promise<void> {
  const started = source.start();
  await vi.advanceTimersByTimeAsync(connectDelayMs);
  await started;
}

describe("createMockSpeechSource", () => {
  it("goes connecting -> listening on start(), and start() resolves once listening", async () => {
    const onStatusChange = vi.fn();
    const source = createMockSpeechSource({
      ...BASE_OPTIONS,
      handlers: { onStatusChange },
      connectDelayMs: 50,
    });

    const startPromise = source.start();
    expect(onStatusChange).toHaveBeenCalledWith("connecting");
    expect(onStatusChange).not.toHaveBeenCalledWith("listening");

    await vi.advanceTimersByTimeAsync(50);
    await startPromise;

    expect(onStatusChange).toHaveBeenLastCalledWith("listening");
  });

  it("resolves stop() with the next scripted result and returns to idle", async () => {
    const onStatusChange = vi.fn();
    const script = [
      { alternatives: [{ transcript: "Cohen", confidence: 0.9 }] },
      { alternatives: [{ transcript: "Nguyen", confidence: 0.8 }] },
    ];
    const source = createMockSpeechSource({
      ...BASE_OPTIONS,
      handlers: { onStatusChange },
      script,
      connectDelayMs: 10,
      finalizeDelayMs: 20,
    });

    await startAndSettle(source, 10);
    vi.clearAllMocks();

    const stopPromise = source.stop();
    expect(onStatusChange).toHaveBeenCalledWith("processing");

    await vi.advanceTimersByTimeAsync(20);
    const result = await stopPromise;

    expect(result).toEqual(script[0]);
    expect(onStatusChange).toHaveBeenLastCalledWith("idle");
  });

  it("cycles through the script and wraps back to the first entry", async () => {
    const script = [
      { alternatives: [{ transcript: "Cohen" }] },
      { alternatives: [{ transcript: "Nguyen" }] },
    ];
    const source = createMockSpeechSource({
      ...BASE_OPTIONS,
      script,
      connectDelayMs: 0,
      finalizeDelayMs: 0,
    });

    async function pressAndRelease() {
      await startAndSettle(source, 0);
      const stopPromise = source.stop();
      await vi.advanceTimersByTimeAsync(0);
      return stopPromise;
    }

    expect(await pressAndRelease()).toEqual(script[0]);
    expect(await pressAndRelease()).toEqual(script[1]);
    expect(await pressAndRelease()).toEqual(script[0]);
  });

  it("reports nothing heard for a press released before the mic reaches listening", async () => {
    const onStatusChange = vi.fn();
    const source = createMockSpeechSource({
      ...BASE_OPTIONS,
      handlers: { onStatusChange },
      connectDelayMs: 200,
    });

    source.start();
    const result = await source.stop();

    expect(result).toEqual({ alternatives: [] });
    // Never reached "listening", and never fires "processing" for a press
    // this short — the whole point is that nothing was captured.
    expect(onStatusChange).not.toHaveBeenCalledWith("listening");
    expect(onStatusChange).not.toHaveBeenCalledWith("processing");
    expect(onStatusChange).toHaveBeenLastCalledWith("idle");
  });

  it("stop() before start() is a harmless no-op that reports nothing heard", async () => {
    const source = createMockSpeechSource(BASE_OPTIONS);
    await expect(source.stop()).resolves.toEqual({ alternatives: [] });
  });

  it("cancel() during connecting stops the mic from ever reaching listening", async () => {
    const onStatusChange = vi.fn();
    const source = createMockSpeechSource({
      ...BASE_OPTIONS,
      handlers: { onStatusChange },
      connectDelayMs: 50,
    });

    source.start();
    source.cancel();
    await vi.advanceTimersByTimeAsync(100);

    expect(onStatusChange).not.toHaveBeenCalledWith("listening");
    expect(onStatusChange).toHaveBeenLastCalledWith("idle");
  });

  it("cancel() during listening leaves the source ready for a clean start next time", async () => {
    const source = createMockSpeechSource({
      ...BASE_OPTIONS,
      script: [{ alternatives: [{ transcript: "Cohen" }] }],
      connectDelayMs: 0,
      finalizeDelayMs: 0,
    });

    await startAndSettle(source, 0);
    source.cancel();

    await startAndSettle(source, 0);
    const stopPromise = source.stop();
    await vi.advanceTimersByTimeAsync(0);
    const result = await stopPromise;
    expect(result).toEqual({ alternatives: [{ transcript: "Cohen" }] });
  });

  it("never touches fetch or WebSocket — it must never call Deepgram", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("speech-mock must never call fetch");
    });
    class ThrowingWebSocket {
      constructor() {
        throw new Error("speech-mock must never open a WebSocket");
      }
    }
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("WebSocket", ThrowingWebSocket);

    const source = createMockSpeechSource({
      ...BASE_OPTIONS,
      connectDelayMs: 0,
      finalizeDelayMs: 0,
    });

    await startAndSettle(source, 0);
    const stopPromise = source.stop();
    await vi.advanceTimersByTimeAsync(0);
    await stopPromise;
    source.cancel();

    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("ships a non-empty default script including a low-confidence, no-match-shaped entry", () => {
    expect(DEMO_SCRIPT.length).toBeGreaterThan(0);
    for (const entry of DEMO_SCRIPT) {
      expect(entry.alternatives.length).toBeGreaterThan(0);
    }
    expect(
      DEMO_SCRIPT.some((entry) =>
        entry.alternatives.every(
          (alternative) =>
            alternative.confidence !== undefined && alternative.confidence < 0.4,
        ),
      ),
    ).toBe(true);
  });
});
