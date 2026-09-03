import { describe, expect, it } from "vitest";

import { downsampleTo16kHz, float32ToInt16PCM } from "./audio-resample";

describe("downsampleTo16kHz", () => {
  it("returns the input unchanged when already at the target rate", () => {
    const input = new Float32Array([0.1, 0.2, 0.3]);
    expect(downsampleTo16kHz(input, 16000)).toBe(input);
  });

  it("halves the length when downsampling 32kHz -> 16kHz", () => {
    const input = new Float32Array(320).fill(0.5);
    const output = downsampleTo16kHz(input, 32000);
    expect(output.length).toBe(160);
  });

  it("produces the expected ~48000 -> 16000 ratio", () => {
    const input = new Float32Array(4800).fill(0.5);
    const output = downsampleTo16kHz(input, 48000);
    expect(output.length).toBe(1600);
  });

  it("handles the fractional 44100 -> 16000 ratio with no NaN in the output", () => {
    const input = new Float32Array(4410).fill(0.5);
    const output = downsampleTo16kHz(input, 44100);
    expect(output.length).toBe(Math.floor(4410 / (44100 / 16000)));
    expect(output.every((sample) => Number.isFinite(sample))).toBe(true);
  });

  it("never produces NaN on a trailing partial block", () => {
    // 100 input samples at a fractional ratio leaves a remainder the last
    // output bucket can't fill evenly -- must average what's there, not
    // divide by zero.
    const input = new Float32Array(100).fill(0.3);
    const output = downsampleTo16kHz(input, 44100, 16000);
    expect(output.every((sample) => Number.isFinite(sample))).toBe(true);
  });

  it("silence in, silence out", () => {
    const input = new Float32Array(480).fill(0);
    const output = downsampleTo16kHz(input, 48000);
    expect(output.every((sample) => sample === 0)).toBe(true);
  });

  it("averages a constant signal to itself", () => {
    const input = new Float32Array(480).fill(0.25);
    const output = downsampleTo16kHz(input, 48000);
    expect(output.every((sample) => Math.abs(sample - 0.25) < 1e-9)).toBe(
      true,
    );
  });

  it("throws rather than silently upsampling", () => {
    const input = new Float32Array([0.1, 0.2]);
    expect(() => downsampleTo16kHz(input, 8000, 16000)).toThrow();
  });
});

describe("float32ToInt16PCM", () => {
  it("maps 0 to 0", () => {
    expect(float32ToInt16PCM(new Float32Array([0]))[0]).toBe(0);
  });

  it("maps 1.0 to the positive 16-bit ceiling", () => {
    expect(float32ToInt16PCM(new Float32Array([1]))[0]).toBe(0x7fff);
  });

  it("maps -1.0 to the negative 16-bit floor", () => {
    expect(float32ToInt16PCM(new Float32Array([-1]))[0]).toBe(-0x8000);
  });

  it("clamps values outside [-1, 1] instead of wrapping", () => {
    const output = float32ToInt16PCM(new Float32Array([2.5, -3.1]));
    expect(output[0]).toBe(0x7fff);
    expect(output[1]).toBe(-0x8000);
  });

  it("preserves array length", () => {
    const input = new Float32Array(10).fill(0.1);
    expect(float32ToInt16PCM(input).length).toBe(10);
  });
});
