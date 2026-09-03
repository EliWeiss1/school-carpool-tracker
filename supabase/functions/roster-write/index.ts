/**
 * Edge Function entrypoint: add a student to the roster, or edit one already
 * on it.
 *
 * Thin on purpose. Everything worth testing lives in
 * _shared/handlers/roster-write.ts, which knows nothing about Deno; this file
 * only wires the runtime to it.
 */

import { readEnv } from "../_shared/env.deno.ts";
import { createRosterWriteHandler } from "../_shared/handlers/roster-write.ts";
import { createRateLimiter } from "../_shared/rate-limit.ts";
import { createSupabaseStore } from "../_shared/supabase-store.deno.ts";

const env = readEnv();

const handle = createRosterWriteHandler({
  staffPin: env.staffPin,
  // A form submit, not a tap during pickup -- generous enough for a busy
  // admin session without being a spam target.
  rateLimiter: createRateLimiter({ limit: 30, windowMs: 60_000 }),
  // Keyed on client IP and spent only on a wrong PIN, because deviceId above
  // comes out of the request body and a guesser simply sends a new one.
  pinAttemptLimiter: createRateLimiter({ limit: 10, windowMs: 600_000 }),
  store: createSupabaseStore(env),
});

Deno.serve(handle);
