/**
 * Edge Function entrypoint: the full roster for /admin.
 *
 * Thin on purpose. Everything worth testing lives in
 * _shared/handlers/roster-list.ts, which knows nothing about Deno; this file
 * only wires the runtime to it.
 */

import { readEnv } from "../_shared/env.deno.ts";
import { createRosterListHandler } from "../_shared/handlers/roster-list.ts";
import { createRateLimiter } from "../_shared/rate-limit.ts";
import { createSupabaseStore } from "../_shared/supabase-store.deno.ts";

const env = readEnv();

const handle = createRosterListHandler({
  staffPin: env.staffPin,
  // A read, and the roster table this loads for a page view or a refresh.
  rateLimiter: createRateLimiter({ limit: 60, windowMs: 60_000 }),
  // Keyed on client IP and spent only on a wrong PIN, because deviceId above
  // comes out of the request body and a guesser simply sends a new one.
  //
  // NOTE: this budget is a SHARED quantity, and nothing in the type system
  // says so. Each Edge Function is its own isolate, so the limits do not pool
  // -- a guesser gets the SUM across every deployed endpoint. See
  // supabase/functions/pin-budget.test.ts, which enforces the total.
  pinAttemptLimiter: createRateLimiter({ limit: 3, windowMs: 600_000 }),
  store: createSupabaseStore(env),
});

Deno.serve(handle);
