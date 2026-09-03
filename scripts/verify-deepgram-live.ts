/**
 * One-shot smoke test for the real Deepgram client's wire protocol --
 * independent of the app, the PIN gate, and the deployed Supabase functions.
 *
 * Generates a short local WAV with Windows' built-in offline text-to-speech
 * (no cloud, no cost), mints a real Deepgram grant token directly (mirroring
 * `supabase/functions/_shared/deepgram.ts`'s request shape), streams the
 * audio through the exact `buildDeepgramListenUrl` / `downsampleTo16kHz` /
 * `float32ToInt16PCM` functions `src/lib/speech-deepgram.ts` uses in the
 * browser, and prints whatever Deepgram transcribes.
 *
 * This exists to catch a wrong query param, bad PCM math, or a broken auth
 * handshake cheaply, before asking anyone to test on a real phone -- it does
 * NOT replace that real-device test (this never touches MediaRecorder,
 * Safari, or the app's own PIN/token flow).
 *
 * Usage:
 *   DEEPGRAM_API_KEY=<your key> npx tsx scripts/verify-deepgram-live.ts ["word to say"]
 *
 * Spends a trivial amount of real Deepgram usage (a few seconds of audio).
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inspect } from "node:util";

import {
  downsampleTo16kHz,
  float32ToInt16PCM,
} from "../src/lib/audio-resample";
import { buildDeepgramListenUrl } from "../src/lib/speech-deepgram";

const DEEPGRAM_GRANT_URL = "https://api.deepgram.com/v1/auth/grant";
const OVERALL_TIMEOUT_MS = 15000;

/**
 * Throws rather than calling process.exit() -- an abrupt exit while Node's
 * native WebSocket still has libuv handles mid-transition (e.g. right after
 * an "error" event, before the socket has finished closing) can crash the
 * process with a native assertion failure on Windows. Throwing lets main()'s
 * own error path close things down and the event loop drain normally.
 */
function fail(message: string): never {
  throw new Error(message);
}

async function mintToken(apiKey: string): Promise<string> {
  const response = await fetch(DEEPGRAM_GRANT_URL, {
    method: "POST",
    headers: {
      authorization: `Token ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ ttl_seconds: 60 }),
  });
  if (!response.ok) {
    fail(`Deepgram refused to mint a token (${response.status}).`);
  }
  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) fail("Deepgram's grant response had no access_token.");
  return payload.access_token;
}

/** Windows' built-in offline SAPI voice -- no network, no API key, no cost. */
function synthesizeWav(word: string, outPath: string): void {
  const script = [
    "Add-Type -AssemblyName System.Speech",
    "$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    `$synth.SetOutputToWaveFile('${outPath.replace(/'/g, "''")}')`,
    `$synth.Speak('${word.replace(/'/g, "''")}')`,
    "$synth.Dispose()",
  ].join("; ");
  execFileSync("powershell.exe", ["-NoProfile", "-Command", script], {
    stdio: "inherit",
  });
}

interface ParsedWav {
  sampleRate: number;
  channels: number;
  samples: Float32Array;
}

/** Minimal RIFF/WAVE parser: enough to read a PCM file SAPI produces. */
function parseWav(buffer: Buffer): ParsedWav {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    fail("Not a RIFF/WAVE file.");
  }

  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let formatTag = 0;
  let data: Buffer | null = null;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;

    if (chunkId === "fmt ") {
      formatTag = buffer.readUInt16LE(chunkStart);
      channels = buffer.readUInt16LE(chunkStart + 2);
      sampleRate = buffer.readUInt32LE(chunkStart + 4);
      bitsPerSample = buffer.readUInt16LE(chunkStart + 14);
    } else if (chunkId === "data") {
      data = buffer.subarray(chunkStart, chunkStart + chunkSize);
    }

    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (!data) fail("WAV file had no data chunk.");
  if (formatTag !== 1 || bitsPerSample !== 16) {
    fail(`Only 16-bit PCM WAV is supported here (got formatTag=${formatTag}, bits=${bitsPerSample}).`);
  }

  const frameCount = data.length / 2 / channels;
  const mono = new Float32Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
    let sum = 0;
    for (let ch = 0; ch < channels; ch++) {
      sum += data.readInt16LE((i * channels + ch) * 2) / 32768;
    }
    mono[i] = sum / channels;
  }

  return { sampleRate, channels, samples: mono };
}

async function main(): Promise<void> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) fail("Set DEEPGRAM_API_KEY in the environment first.");

  const word = process.argv[2] ?? "Nguyen";
  const workDir = mkdtempSync(path.join(tmpdir(), "deepgram-smoke-"));
  const wavPath = path.join(workDir, "sample.wav");

  try {
    console.log(`Synthesizing "${word}" locally (Windows SAPI, no network)...`);
    synthesizeWav(word, wavPath);

    const wav = parseWav(readFileSync(wavPath));
    console.log(
      `WAV: ${wav.sampleRate}Hz, ${wav.channels}ch, ${wav.samples.length} samples`,
    );

    const pcm16k = float32ToInt16PCM(
      downsampleTo16kHz(wav.samples, wav.sampleRate, 16000),
    );

    console.log("Minting a real Deepgram token via /v1/auth/grant...");
    const token = await mintToken(apiKey);

    const url = buildDeepgramListenUrl([word]);
    console.log(`Connecting to ${url}`);

    await new Promise<void>((resolve, reject) => {
      const overallTimeout = setTimeout(() => {
        reject(new Error(`No final transcript within ${OVERALL_TIMEOUT_MS}ms.`));
      }, OVERALL_TIMEOUT_MS);

      // Node's built-in WebSocket (stable since Node 22) supports the same
      // (url, protocols) constructor shape as the browser -- the same
      // Sec-WebSocket-Protocol auth path speech-deepgram.ts uses. "bearer",
      // not "token": this is a granted JWT, not a permanent API key.
      const socket = new WebSocket(url, ["bearer", token]);
      socket.binaryType = "arraybuffer";

      socket.addEventListener("close", (event) => {
        const closeEvent = event as { code?: number; reason?: string };
        console.log(
          `Socket closed: code=${closeEvent.code} reason="${closeEvent.reason ?? ""}"`,
        );
      });

      socket.addEventListener("open", () => {
        console.log("Connected. Streaming PCM...");
        const CHUNK = 4096;
        for (let i = 0; i < pcm16k.length; i += CHUNK) {
          const slice = pcm16k.subarray(i, i + CHUNK);
          socket.send(slice.buffer.slice(
            slice.byteOffset,
            slice.byteOffset + slice.byteLength,
          ));
        }
        socket.send(JSON.stringify({ type: "CloseStream" }));
      });

      socket.addEventListener("message", (event) => {
        if (typeof event.data !== "string") return;
        let payload: unknown;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }
        console.log("Received:", JSON.stringify(payload));

        const record = payload as Record<string, unknown>;
        if (record.type !== "Results") return;
        if (record.is_final !== true && record.speech_final !== true) return;

        const channel = record.channel as { alternatives?: unknown[] } | undefined;
        const transcript = (channel?.alternatives?.[0] as { transcript?: string } | undefined)
          ?.transcript;

        clearTimeout(overallTimeout);
        console.log(`\nFinal transcript: "${transcript ?? ""}"`);
        socket.close();
        resolve();
      });

      socket.addEventListener("error", (event) => {
        clearTimeout(overallTimeout);
        // Error/Event objects don't serialize usefully through JSON.stringify
        // or String() (their informative properties aren't enumerable) --
        // inspect it directly to see whatever Node's WebSocket attaches.
        console.error(
          "Raw error event:",
          inspect(event, { depth: 5, showHidden: true }),
        );
        try {
          socket.close();
        } catch {
          // Best-effort -- we're already failing.
        }
        reject(new Error("WebSocket error -- see raw event dump above."));
      });
    });

    console.log("\nPASS: real Deepgram round trip succeeded.");
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
