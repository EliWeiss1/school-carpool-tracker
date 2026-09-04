/**
 * Edge Function entrypoint: create, edit or delete a carpool and set its
 * members.
 *
 * Thin on purpose. Everything worth testing lives in
 * _shared/handlers/carpool-write.ts, which knows nothing about Deno; this
 * file only wires the runtime to it.
 */

import { readEnv } from "../_shared/env.deno.ts";
import { createCarpoolWriteHandler } from "../_shared/handlers/carpool-write.ts";
import { createRateLimiter } from "../_shared/rate-limit.ts";
import { createSupabaseStore } from "../_shared/supabase-store.deno.ts";

const env = readEnv();

const handle = createCarpoolWriteHandler({
  staffPin: env.staffPin,
  // A form submit from the office, same pace as roster-write.
  rateLimiter: createRateLimiter({ limit: 30, windowMs: 60_000 }),
  // Keyed on client IP and spent only on a wrong PIN, because deviceId above
  // comes out of the request body and a guesser simply sends a new one.
  //
  // NOTE: this budget is a SHARED quantity, and nothing in the type system
  // says so. Each Edge Function is its own isolate, so the limits do not pool
  // -- a guesser gets the SUM across every deployed endpoint. See
  // supabase/functions/pin-budget.test.ts, which enforces the total. This
  // endpoint is driven by the same office computer as the other roster
  // endpoints, so 3 matches theirs and keeps the total from creeping.
  pinAttemptLimiter: createRateLimiter({ limit: 3, windowMs: 600_000 }),
  store: createSupabaseStore(env),
});

Deno.serve(handle);
