/**
 * Edge Function entrypoint: the only write path in the app.
 *
 * Re-validates the staff PIN itself; /resolve-name having accepted one earlier
 * proves nothing about this request.
 */

import { readEnv } from "../_shared/env.deno.ts";
import { createStatusHandler } from "../_shared/handlers/status.ts";
import { createRateLimiter } from "../_shared/rate-limit.ts";
import { createSupabaseStore } from "../_shared/supabase-store.deno.ts";

const env = readEnv();

const handle = createStatusHandler({
  staffPin: env.staffPin,
  // Tighter than resolving: this one changes what a teacher sees. A whole class
  // arriving in one minute still fits comfortably.
  rateLimiter: createRateLimiter({ limit: 30, windowMs: 60_000 }),
  // Keyed on client IP and spent only on a wrong PIN, because deviceId above
  // comes out of the request body and a guesser simply sends a new one.
  pinAttemptLimiter: createRateLimiter({ limit: 10, windowMs: 600_000 }),
  store: createSupabaseStore(env),
});

Deno.serve(handle);
