/**
 * A per-tab identifier for the rate limiter to bucket on.
 *
 * It is not a security control and CLAUDE.md says so: the server treats it as
 * self-reported and forgeable, and keys the PIN-guessing budget on client IP
 * instead. All this has to do is stop one honest phone's burst of confirmations
 * from spending another phone's allowance, so a random value that lives as long
 * as the tab is exactly right — and it deliberately does not persist, because a
 * stable device id across sessions would be a tracking identifier for nothing.
 */

let cached: string | null = null;

function generate(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  // Older iPad Safari on a school cart has no randomUUID. Collisions here cost
  // two devices a shared rate-limit bucket, nothing more.
  return `device-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export function deviceId(): string {
  cached ??= generate();
  return cached;
}
