import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The PIN-guessing budget is a SHARED quantity that nothing in the type system
 * models.
 *
 * Every Edge Function runs in its own isolate, so `pinAttemptLimiter` counters
 * do not pool: an attacker's real allowance is the SUM of the per-endpoint
 * limits across everything deployed. Each entrypoint therefore looks perfectly
 * reasonable in isolation while the total quietly grows every time an endpoint
 * is added — which is the same class of mistake as the phase-3 bypass, where a
 * single endpoint's missing limiter was invisible until someone read all of
 * them together.
 *
 * This test is that reading. It exists so the arithmetic happens at the moment
 * an endpoint is added rather than never.
 *
 * These files are excluded from `tsc` and have no other test coverage, so this
 * is also the only automated check that they parse the way we think they do.
 */

const FUNCTIONS_DIR = join(__dirname);

/**
 * The ceiling, in wrong PINs per 10 minutes, across the whole deployment.
 *
 * Phase 3 costed 30 (three endpoints at 10) and CLAUDE.md's judgment call says
 * the mitigation for a weak PIN is a longer PIN, not a looser limit. Raising
 * this number spends the margin that a longer PIN was meant to buy, so raise it
 * only deliberately, and prefer a 6+ digit PIN over a bigger allowance.
 */
const MAX_TOTAL_PIN_ATTEMPTS_PER_WINDOW = 50;

/** The window every limiter must share, or the totals above are meaningless. */
const REQUIRED_WINDOW_MS = "600_000";

function entrypoints(): { name: string; source: string }[] {
  return readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => ({
      name: entry.name,
      source: readFileSync(join(FUNCTIONS_DIR, entry.name, "index.ts"), "utf8"),
    }));
}

const PIN_LIMITER =
  /pinAttemptLimiter:\s*createRateLimiter\(\{\s*limit:\s*(\d+),\s*windowMs:\s*([0-9_]+)\s*\}\)/;

describe("the PIN-guessing budget across every deployed endpoint", () => {
  const found = entrypoints();

  it("finds every Edge Function entrypoint", () => {
    expect(found.length).toBeGreaterThanOrEqual(8);
  });

  for (const { name, source } of found) {
    it(`${name} passes a real pinAttemptLimiter`, () => {
      // Not merely "mentions pinAttemptLimiter": the phase-3 bug was a dep that
      // was accepted as optional and simply never supplied.
      expect(source).toMatch(PIN_LIMITER);
    });

    it(`${name} passes a real per-device rateLimiter too`, () => {
      expect(source).toMatch(
        /rateLimiter:\s*createRateLimiter\(\{\s*limit:\s*\d+/,
      );
    });

    it(`${name} uses the shared 10-minute window`, () => {
      const match = PIN_LIMITER.exec(source);
      expect(match?.[2]).toBe(REQUIRED_WINDOW_MS);
    });
  }

  it("keeps the TOTAL allowance across all endpoints under the ceiling", () => {
    const total = found.reduce((sum, { source }) => {
      const match = PIN_LIMITER.exec(source);
      return sum + Number(match?.[1] ?? 0);
    }, 0);

    // If this fails because you added an endpoint: lower the per-endpoint
    // limits rather than raising the ceiling. The ceiling is the security
    // property; the per-endpoint numbers are just how it is divided up.
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_PIN_ATTEMPTS_PER_WINDOW);
  });
});
