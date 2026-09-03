/**
 * Edge Function entrypoint: move every arrived student back to waiting.
 *
 * Thin on purpose. Everything worth testing lives in
 * _shared/handlers/roster-reset.ts, which knows nothing about Deno; this file
 * only wires the runtime to it.
 */

import { readEnv } from "../_shared/env.deno.ts";
import { createRosterResetHandler } from "../_shared/handlers/roster-reset.ts";
import { createRateLimiter } from "../_shared/rate-limit.ts";
import { createSupabaseStore } from "../_shared/supabase-store.deno.ts";

const env = readEnv();

const handle = createRosterResetHandler({
  staffPin: env.staffPin,
  // A once-a-morning action from the office, not a repeated one.
  rateLimiter: createRateLimiter({ limit: 5, windowMs: 60_000 }),
  // Keyed on client IP and spent only on a wrong PIN, because deviceId above
  // comes out of the request body and a guesser simply sends a new one.
  pinAttemptLimiter: createRateLimiter({ limit: 10, windowMs: 600_000 }),
  store: createSupabaseStore(env),
});

Deno.serve(handle);
