/**
 * Pure PCM math for streaming mic audio to Deepgram: downsample whatever rate
 * the browser's AudioContext is actually running at (44.1kHz/48kHz) to the
 * 16kHz mono linear PCM Deepgram's streaming API expects, and convert
 * Float32 samples to 16-bit integers.
 *
 * No browser APIs, no state -- plain arrays in, plain arrays out, so this is
 * unit-tested with no AudioContext and no mic.
 */

/**
 * Box-filter decimation: each output sample is the mean of the input samples
 * that fall in its slice of the input. Simple, dependency-free, and adequate
 * anti-aliasing for speech -- Deepgram's own models tolerate far worse.
 */
export function downsampleTo16kHz(
  input: Float32Array,
  inputSampleRate: number,
  outputSampleRate = 16000,
): Float32Array {
  if (outputSampleRate === inputSampleRate) return input;
  if (outputSampleRate > inputSampleRate) {
    throw new Error(
      `Cannot upsample from ${inputSampleRate}Hz to ${outputSampleRate}Hz.`,
    );
  }

  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    output[i] = end > start ? sum / (end - start) : 0;
  }

  return output;
}

/** Clamps to [-1, 1] before scaling, so a hot mic input can't wrap around. */
export function float32ToInt16PCM(samples: Float32Array): Int16Array {
  const output = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    output[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return output;
}
