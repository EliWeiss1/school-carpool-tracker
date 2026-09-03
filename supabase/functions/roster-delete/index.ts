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
  //
  // NOTE: this budget is a SHARED quantity, and nothing in the type system
  // says so. Each Edge Function is its own isolate, so the limits do not pool
  // -- a guesser gets the SUM across every deployed endpoint. Three endpoints
  // at 10 was the 30-per-10-minutes phase 3 costed; eight endpoints at 10
  // would silently have been 80, cutting the time to break a 6-digit PIN from
  // months to weeks. The roster endpoints are driven by one office computer
  // where the PIN is typed once at the gate, so 3 is ample for them and keeps
  // the total near where it started. Do this arithmetic again before adding
  // another endpoint.
  pinAttemptLimiter: createRateLimiter({ limit: 3, windowMs: 600_000 }),
  store: createSupabaseStore(env),
});

Deno.serve(handle);
