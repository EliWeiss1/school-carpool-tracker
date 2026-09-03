import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type AudioCapture,
  type CreateAudioCapture,
  buildDeepgramListenUrl,
  createDeepgramSpeechSource,
} from "./speech-deepgram";

/** Minimal in-memory stand-in for the browser WebSocket, driven manually by tests. */
class FakeWebSocket {
  url: string;
  protocols: string[];
  readyState = 0; // CONNECTING
  binaryType = "";
  sent: (string | ArrayBuffer)[] = [];
  closeCalls = 0;
  private listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(url: string, protocols: string[]) {
    this.url = url;
    this.protocols = protocols;
  }

  addEventListener(
    type: string,
    listener: (event: unknown) => void,
    options?: { once?: boolean },
  ): void {
    const set = this.listeners.get(type) ?? new Set();
    if (options?.once) {
      const wrapped = (event: unknown) => {
        this.removeEventListener(type, wrapped);
        listener(event);
      };
      set.add(wrapped);
    } else {
      set.add(listener);
    }
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string | ArrayBuffer): void {
    this.sent.push(data);
  }

  close(): void {
    this.closeCalls += 1;
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.dispatch("close", {});
  }

  private dispatch(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  /** Test helper: simulate the connection succeeding. */
  open(): void {
    this.readyState = 1;
    this.dispatch("open", {});
  }

  /** Test helper: simulate the *server* dropping the connection unexpectedly
   *  (network hiccup, idle timeout) -- as opposed to close(), which is our
   *  own side hanging up. */
  simulateServerClose(): void {
    this.readyState = 3;
    this.dispatch("close", {});
  }

  /** Test helper: simulate a Deepgram frame arriving. */
  receive(payload: unknown): void {
    this.dispatch("message", { data: JSON.stringify(payload) });
  }
}

function finalResults(transcript: string, confidence = 0.9) {
  return {
    type: "Results",
    is_final: true,
    channel: { alternatives: [{ transcript, confidence }] },
  };
}

/** A distinct fake MediaStream per call, so "the stale attempt released its
 *  own mic" and "it released the live session's mic" are actually
 *  distinguishable -- a shared fixture across every press can't tell them apart. */
function createFakeStream() {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  return { track, stream };
}

function harness() {
  const sockets: FakeWebSocket[] = [];
  const createWebSocket = (url: string, protocols: string[]) => {
    const socket = new FakeWebSocket(url, protocols);
    sockets.push(socket);
    return socket as unknown as WebSocket;
  };

  const captures: Array<{ onChunk: (pcm: Int16Array) => void; stopped: boolean }> = [];
  // Mirrors createWebAudioCapture's real contract: stopping the capture also
  // releases the underlying stream's tracks, not just its own bookkeeping.
  const createAudioCapture: CreateAudioCapture = (stream, onChunk) => {
    const record = { onChunk, stopped: false };
    captures.push(record);
    const capture: AudioCapture = {
      stop() {
        record.stopped = true;
        for (const track of stream.getTracks()) track.stop();
      },
    };
    return capture;
  };

  const streams: Array<ReturnType<typeof createFakeStream>> = [];
  const getUserMedia = vi.fn().mockImplementation(async () => {
    const fake = createFakeStream();
    streams.push(fake);
    return fake.stream;
  });
  const onStatusChange = vi.fn();

  const source = createDeepgramSpeechSource({
    token: "dg-temp-token",
    keyterms: ["Cohen", "Nguyen"],
    handlers: { onStatusChange },
    deps: { getUserMedia, createWebSocket, createAudioCapture },
  });

  return {
    source,
    sockets,
    captures,
    streams,
    getUserMedia,
    createWebSocket,
    createAudioCapture,
    onStatusChange,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("buildDeepgramListenUrl", () => {
  it("targets nova-3 with linear16/16kHz/mono and one keyterm param per surname", () => {
    const url = new URL(buildDeepgramListenUrl(["Cohen", "Nguyen"]));
    expect(url.protocol).toBe("wss:");
    expect(url.searchParams.get("model")).toBe("nova-3");
    expect(url.searchParams.get("encoding")).toBe("linear16");
    expect(url.searchParams.get("sample_rate")).toBe("16000");
    expect(url.searchParams.get("channels")).toBe("1");
    expect(url.searchParams.getAll("keyterm")).toEqual(["Cohen", "Nguyen"]);
  });

  it("skips blank keyterms", () => {
    const url = new URL(buildDeepgramListenUrl(["Cohen", "", "  "]));
    expect(url.searchParams.getAll("keyterm")).toEqual(["Cohen"]);
  });

  it("never puts a credential anywhere in the URL", () => {
    const url = buildDeepgramListenUrl(["Cohen"]);
    expect(url).not.toMatch(/token/i);
  });
});

/** Presses start(), lets it reach the socket, and opens the latest one. */
async function pressAndOpen(
  source: ReturnType<typeof createDeepgramSpeechSource>,
  sockets: FakeWebSocket[],
): Promise<void> {
  const startPromise = source.start();
  await Promise.resolve();
  await Promise.resolve();
  sockets[sockets.length - 1].open();
  await startPromise;
}

describe("createDeepgramSpeechSource", () => {
  it("rejects immediately when the token is the server's mock-mode sentinel, without touching the mic", async () => {
    const { sockets, getUserMedia, createWebSocket, createAudioCapture } =
      harness();
    const source = createDeepgramSpeechSource({
      token: "mock-deepgram-token",
      keyterms: [],
      deps: { getUserMedia, createWebSocket, createAudioCapture },
    });

    await expect(source.start()).rejects.toThrow(/test mode/i);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(sockets).toHaveLength(0);
  });

  it("a socket dropping mid-listen doesn't wedge the mic: the next press gets its own socket, its own mic, and its own transcript", async () => {
    const { source, sockets, captures, streams } = harness();

    await pressAndOpen(source, sockets);
    sockets[0].simulateServerClose();
    const firstResult = await source.stop();
    expect(firstResult).toEqual({ alternatives: [] });
    expect(streams[0].track.stop).toHaveBeenCalled();

    await pressAndOpen(source, sockets);
    expect(sockets).toHaveLength(2);
    expect(streams).toHaveLength(2);

    const stopPromise = source.stop();
    expect(captures[1].stopped).toBe(true);
    sockets[1].receive(finalResults("Nguyen"));
    const secondResult = await stopPromise;

    expect(secondResult.alternatives[0].transcript).toBe("Nguyen");
    // The second press's own mic, not the first's, is what got released here.
    expect(streams[1].track.stop).toHaveBeenCalled();
  });

  it("a stale finalize timer from a preempted press never touches the mic or socket of the press that replaced it", async () => {
    const { source, sockets, captures, streams } = harness();

    await pressAndOpen(source, sockets);
    source.stop(); // armed, never answered -- left pending on purpose
    await vi.advanceTimersByTimeAsync(500);

    // A fast double-press: start() again before the first press's finalize
    // timer (2000ms) has fired.
    await pressAndOpen(source, sockets);
    expect(sockets).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(2000);

    expect(captures[1].stopped).toBe(false);
    expect(sockets[1].closeCalls).toBe(0);
    expect(streams[1].track.stop).not.toHaveBeenCalled();
  });

  it("a final transcript already known when stop() is called still waits for CloseStream's own close before answering", async () => {
    const { source, sockets } = harness();

    await pressAndOpen(source, sockets);
    sockets[0].receive(finalResults("Cohen", 0.93));

    const stopPromise = source.stop();
    expect(sockets[0].sent).toContain(JSON.stringify({ type: "CloseStream" }));

    sockets[0].simulateServerClose();
    const result = await stopPromise;

    expect(result).toEqual({
      alternatives: [{ transcript: "Cohen", confidence: 0.93 }],
    });
  });

  it("a self-correction after an early endpoint is not discarded: the later word wins, not the first", async () => {
    const { source, sockets } = harness();

    await pressAndOpen(source, sockets);
    // Deepgram endpoints "Chen" on a mid-press pause...
    sockets[0].receive(finalResults("Chen", 0.7));

    // ...the staff member keeps talking ("no, Chan") and releases.
    const stopPromise = source.stop();
    expect(sockets[0].sent).toContain(JSON.stringify({ type: "CloseStream" }));

    // CloseStream's own flush brings back the corrected word before the
    // socket closes.
    sockets[0].receive(finalResults("Chan", 0.88));
    sockets[0].simulateServerClose();

    const result = await stopPromise;
    expect(result.alternatives[0].transcript).toBe("Chan");
  });

  it("cancel() while a stop() is still pending settles it instead of hanging forever", async () => {
    const { source, sockets } = harness();

    await pressAndOpen(source, sockets);
    const stopPromise = source.stop(); // never answered
    source.cancel();

    await expect(stopPromise).resolves.toEqual({ alternatives: [] });
  });

  it("a tap released during connecting doesn't block the next full press from succeeding", async () => {
    const { source, sockets } = harness();

    source.start();
    await Promise.resolve();
    await Promise.resolve();
    await source.stop();

    await pressAndOpen(source, sockets);
    expect(sockets).toHaveLength(2);

    const stopPromise = source.stop();
    sockets[1].receive(finalResults("Cohen"));
    await expect(stopPromise).resolves.toEqual({
      alternatives: [{ transcript: "Cohen", confidence: 0.9 }],
    });
  });

  it("three rapid overlapping presses: the first two settle empty exactly once, the third gets its own transcript, nothing is left armed", async () => {
    const { source, sockets, captures, streams } = harness();

    await pressAndOpen(source, sockets);
    const firstStop = source.stop(); // never answered

    await pressAndOpen(source, sockets);
    const secondStop = source.stop(); // never answered either

    await pressAndOpen(source, sockets);
    expect(sockets).toHaveLength(3);

    const thirdStop = source.stop();
    sockets[2].receive(finalResults("Nguyen"));

    const [first, second, third] = await Promise.all([
      firstStop,
      secondStop,
      thirdStop,
    ]);

    expect(first).toEqual({ alternatives: [] });
    expect(second).toEqual({ alternatives: [] });
    expect(third.alternatives[0].transcript).toBe("Nguyen");

    expect(streams[0].track.stop).toHaveBeenCalled();
    expect(streams[1].track.stop).toHaveBeenCalled();
    expect(captures[2].stopped).toBe(true);

    await vi.advanceTimersByTimeAsync(20000);
    expect(sockets[2].closeCalls).toBeGreaterThan(0); // from its own stop(), not a stray timer
  });

  it("a late duplicate final for a finished session cannot be served to the press that replaced it", async () => {
    const { source, sockets } = harness();

    await pressAndOpen(source, sockets);
    const stopPromise = source.stop();
    sockets[0].receive(finalResults("Cohen"));
    await stopPromise;

    await pressAndOpen(source, sockets);
    // A duplicate/late message for the finished first session's socket.
    sockets[0].receive(finalResults("Cohen"));

    const secondStop = source.stop();
    sockets[1].receive(finalResults("Nguyen"));
    const result = await secondStop;

    expect(result.alternatives[0].transcript).toBe("Nguyen");
  });

  it("goes connecting -> listening once the socket opens, authenticated via the bearer subprotocol", async () => {
    const { source, sockets, onStatusChange } = harness();

    const startPromise = source.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(onStatusChange).toHaveBeenCalledWith("connecting");
    expect(sockets).toHaveLength(1);
    // "bearer", not "token": the token is always a granted JWT, never a
    // permanent API key -- confirmed empirically against real Deepgram
    // (["token", jwt] closes with code 1006; ["bearer", jwt] opens).
    expect(sockets[0].protocols).toEqual(["bearer", "dg-temp-token"]);

    sockets[0].open();
    await startPromise;

    expect(onStatusChange).toHaveBeenLastCalledWith("listening");
  });

  it("streams PCM chunks over the socket once listening", async () => {
    const { source, sockets, captures } = harness();

    const startPromise = source.start();
    await Promise.resolve();
    await Promise.resolve();
    sockets[0].open();
    await startPromise;

    const chunk = new Int16Array([1, 2, 3]);
    captures[0].onChunk(chunk);

    expect(sockets[0].sent).toEqual([chunk.buffer]);
  });

  it("sends CloseStream on stop() and resolves with the final transcript", async () => {
    const { source, sockets, onStatusChange } = harness();

    const startPromise = source.start();
    await Promise.resolve();
    await Promise.resolve();
    sockets[0].open();
    await startPromise;
    vi.clearAllMocks();

    const stopPromise = source.stop();
    expect(onStatusChange).toHaveBeenCalledWith("processing");
    expect(sockets[0].sent).toEqual([JSON.stringify({ type: "CloseStream" })]);

    sockets[0].receive(finalResults("Cohen", 0.93));
    const result = await stopPromise;

    expect(result).toEqual({ alternatives: [{ transcript: "Cohen", confidence: 0.93 }] });
    expect(onStatusChange).toHaveBeenLastCalledWith("idle");
  });

  it("ignores interim (non-final) results and waits for the final one", async () => {
    const { source, sockets } = harness();

    const startPromise = source.start();
    await Promise.resolve();
    await Promise.resolve();
    sockets[0].open();
    await startPromise;

    const stopPromise = source.stop();
    sockets[0].receive({
      type: "Results",
      is_final: false,
      channel: { alternatives: [{ transcript: "Coh" }] },
    });
    sockets[0].receive(finalResults("Cohen"));

    const result = await stopPromise;
    expect(result.alternatives[0].transcript).toBe("Cohen");
  });

  it("falls back to the safety timeout if Deepgram never answers", async () => {
    const { source, sockets, onStatusChange } = harness();

    const startPromise = source.start();
    await Promise.resolve();
    await Promise.resolve();
    sockets[0].open();
    await startPromise;

    const stopPromise = source.stop();
    await vi.advanceTimersByTimeAsync(2000);
    const result = await stopPromise;

    expect(result).toEqual({ alternatives: [] });
    expect(onStatusChange).toHaveBeenLastCalledWith("idle");
    expect(sockets[0].closeCalls).toBeGreaterThan(0);
  });

  it("stop() released before the socket opens aborts cleanly and releases the mic", async () => {
    const { source, sockets, streams } = harness();

    source.start();
    await Promise.resolve();
    await Promise.resolve();
    const result = await source.stop();

    expect(result).toEqual({ alternatives: [] });

    // The connect attempt finishing late must not resurrect the session.
    sockets[0].open();
    await vi.advanceTimersByTimeAsync(0);
    expect(streams[0].track.stop).toHaveBeenCalled();
  });

  it("stop() during connecting closes the already-created socket immediately, not after the connect timeout", async () => {
    const { source, sockets, streams } = harness();

    source.start();
    await Promise.resolve();
    await Promise.resolve();
    // The socket already exists at this point (mid-connect) even though
    // status hasn't reached "listening" yet.
    expect(sockets).toHaveLength(1);

    await source.stop();

    // Must be closed right away -- not left open for up to
    // CONNECT_TIMEOUT_MS waiting for the abandoned attempt to notice on
    // its own the next time it wakes up.
    expect(sockets[0].closeCalls).toBeGreaterThan(0);
    expect(streams[0].track.stop).toHaveBeenCalled();
    // And no connect-timeout timer is left ticking on a dead component.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancel() during connecting also leaves no connect-timeout timer armed", async () => {
    const { source, sockets } = harness();

    source.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(sockets).toHaveLength(1);

    source.cancel();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("start() called again immediately after cancel() begins a fresh attempt, not the stale cancelled one", async () => {
    const { source, sockets, getUserMedia } = harness();

    source.start();
    await Promise.resolve();
    await Promise.resolve();
    source.cancel();

    const secondStart = source.start();
    await Promise.resolve();
    await Promise.resolve();

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(sockets).toHaveLength(2);

    sockets[1].open();
    await secondStart;

    expect(sockets[1].closeCalls).toBe(0);
  });

  it("stop() before start() is a harmless no-op", async () => {
    const { source } = harness();
    await expect(source.stop()).resolves.toEqual({ alternatives: [] });
  });

  it("cancel() during listening releases the mic and socket with no pending timers left behind", async () => {
    const { source, sockets, captures } = harness();

    const startPromise = source.start();
    await Promise.resolve();
    await Promise.resolve();
    sockets[0].open();
    await startPromise;

    source.cancel();

    expect(captures[0].stopped).toBe(true);
    expect(sockets[0].closeCalls).toBeGreaterThan(0);
    expect(vi.getTimerCount()).toBe(0);

    // No stray timer should fire and try to resolve anything after cancel.
    await vi.advanceTimersByTimeAsync(5000);
  });

  it("a new start() after stop() reuses the same source cleanly (the fix for the reported bug)", async () => {
    const { source, sockets } = harness();

    async function pressAndRelease(transcript: string) {
      const startPromise = source.start();
      await Promise.resolve();
      await Promise.resolve();
      sockets[sockets.length - 1].open();
      await startPromise;

      const stopPromise = source.stop();
      sockets[sockets.length - 1].receive(finalResults(transcript));
      return stopPromise;
    }

    const first = await pressAndRelease("Cohen");
    const second = await pressAndRelease("Nguyen");

    expect(first.alternatives[0].transcript).toBe("Cohen");
    expect(second.alternatives[0].transcript).toBe("Nguyen");
    expect(sockets).toHaveLength(2);
  });
});
