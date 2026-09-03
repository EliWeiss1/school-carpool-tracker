#!/usr/bin/env node
/**
 * Synthesizes `public/chime.wav`: the sound /display makes on an arrival.
 *
 * Generated from code rather than fetched, per CLAUDE.md's phase 5 brief --
 * this script is the source of truth for the sound, and the committed WAV is
 * its build output. Re-run it any time the sound itself needs to change:
 *
 *   node scripts/generate-chime.mjs
 *
 * Design brief: a teacher hears this dozens of times over an afternoon, so it
 * has to stay pleasant on the fiftieth play, not just the first. That rules
 * out anything with a hard attack or a long tail -- this is two soft sine
 * tones (a rising major sixth, like a doorbell) with a slow raised-cosine
 * envelope on each, mixed a few milliseconds apart, well under a second long
 * and never near full scale.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SAMPLE_RATE = 44100;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

/** Raised-cosine envelope: no click on attack or release, unlike a linear ramp. */
function envelope(tSeconds, attack, hold, release) {
  if (tSeconds < 0) return 0;
  if (tSeconds < attack) {
    return 0.5 - 0.5 * Math.cos((Math.PI * tSeconds) / attack);
  }
  if (tSeconds < attack + hold) return 1;
  const tRelease = tSeconds - attack - hold;
  if (tRelease < release) {
    return 0.5 + 0.5 * Math.cos((Math.PI * tRelease) / release);
  }
  return 0;
}

/** One soft sine note, starting `startSeconds` into the buffer. */
function note(buffer, startSeconds, freqHz, peakAmplitude, attack, hold, release) {
  const startSample = Math.round(startSeconds * SAMPLE_RATE);
  const durationSamples = Math.round((attack + hold + release) * SAMPLE_RATE);

  for (let i = 0; i < durationSamples; i++) {
    const sampleIndex = startSample + i;
    if (sampleIndex < 0 || sampleIndex >= buffer.length) continue;

    const tSeconds = i / SAMPLE_RATE;
    const gain = envelope(tSeconds, attack, hold, release) * peakAmplitude;
    const value = gain * Math.sin(2 * Math.PI * freqHz * tSeconds);
    buffer[sampleIndex] += value;
  }
}

function synthesizeChime() {
  const totalSeconds = 0.85;
  const totalSamples = Math.round(totalSeconds * SAMPLE_RATE);
  const buffer = new Float64Array(totalSamples);

  // A rising major sixth (E5 -> C#6) reads as a gentle, resolved "ding-ding"
  // rather than a klaxon. Second note enters slightly before the first fully
  // decays, so the two blend instead of sounding like two separate alerts.
  note(buffer, 0.0, 659.25 /* E5 */, 0.32, 0.02, 0.1, 0.32);
  note(buffer, 0.11, 830.61 /* C#6 */, 0.26, 0.03, 0.12, 0.42);

  return buffer;
}

function floatTo16BitPCM(float64Samples) {
  const out = new Int16Array(float64Samples.length);
  for (let i = 0; i < float64Samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float64Samples[i]));
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return out;
}

function encodeWav(pcmSamples) {
  const dataSize = pcmSamples.length * (BITS_PER_SAMPLE / 8);
  const blockAlign = CHANNELS * (BITS_PER_SAMPLE / 8);
  const byteRate = SAMPLE_RATE * blockAlign;

  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");

  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(CHANNELS, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(BITS_PER_SAMPLE, 34);

  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < pcmSamples.length; i++) {
    buffer.writeInt16LE(pcmSamples[i], 44 + i * 2);
  }

  return buffer;
}

function main() {
  const outPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "public",
    "chime.wav",
  );

  const floatSamples = synthesizeChime();
  const pcmSamples = floatTo16BitPCM(floatSamples);
  const wav = encodeWav(pcmSamples);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, wav);

  const seconds = (floatSamples.length / SAMPLE_RATE).toFixed(2);
  console.log(`Wrote ${outPath} (${seconds}s, ${wav.length} bytes)`);
}

main();
