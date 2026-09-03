/**
 * Edge Function entrypoint: remove a student from the roster.
 *
 * Thin on purpose. Everything worth testing lives in
 * _shared/handlers/roster-delete.ts, which knows nothing about Deno; this file
 * only wires the runtime to it.
 */

import { readEnv } from "../_shared/env.deno.ts";
import { createRosterDeleteHandler } from "../_shared/handlers/roster-delete.ts";
import { createRateLimiter } from "../_shared/rate-limit.ts";
import { createSupabaseStore } from "../_shared/supabase-store.deno.ts";

const env = readEnv();

const handle = createRosterDeleteHandler({
  staffPin: env.staffPin,
  // Deliberately the tightest limit of any roster-write endpoint: this is the
  // one action here that another admin write cannot undo.
  rateLimiter: createRateLimiter({ limit: 20, windowMs: 60_000 }),
  // Keyed on client IP and spent only on a wrong PIN, because deviceId above
  // comes out of the request body and a guesser simply sends a new one.
  pinAttemptLimiter: createRateLimiter({ limit: 10, windowMs: 600_000 }),
  store: createSupabaseStore(env),
});

Deno.serve(handle);
