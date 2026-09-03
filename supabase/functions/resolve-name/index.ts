/**
 * Edge Function entrypoint: match a transcript against the roster.
 *
 * Read-only. The status change is a separate call, made only after a human taps
 * one of the candidates this returns.
 */

import { readEnv } from "../_shared/env.deno.ts";
import { createResolveHandler } from "../_shared/handlers/resolve.ts";
import { createRateLimiter } from "../_shared/rate-limit.ts";
import { createSupabaseStore } from "../_shared/supabase-store.deno.ts";

const env = readEnv();

const handle = createResolveHandler({
  staffPin: env.staffPin,
  // One announcement every couple of seconds is a brisk but plausible pace.
  rateLimiter: createRateLimiter({ limit: 40, windowMs: 60_000 }),
  // Keyed on client IP and spent only on a wrong PIN, because deviceId above
  // comes out of the request body and a guesser simply sends a new one.
  pinAttemptLimiter: createRateLimiter({ limit: 10, windowMs: 600_000 }),
  store: createSupabaseStore(env),
});

Deno.serve(handle);
