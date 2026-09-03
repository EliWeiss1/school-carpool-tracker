/**
 * Edge Function entrypoint: bulk-create the students from a confirmed CSV
 * import.
 *
 * Thin on purpose. Everything worth testing lives in
 * _shared/handlers/roster-import.ts, which knows nothing about Deno; this file
 * only wires the runtime to it.
 */

import { readEnv } from "../_shared/env.deno.ts";
import { createRosterImportHandler } from "../_shared/handlers/roster-import.ts";
import { createRateLimiter } from "../_shared/rate-limit.ts";
import { createSupabaseStore } from "../_shared/supabase-store.deno.ts";

const env = readEnv();

const handle = createRosterImportHandler({
  staffPin: env.staffPin,
  // A whole-roster import is a rare, deliberate action -- once at setup, maybe
  // once a term -- so the budget is tight on purpose.
  rateLimiter: createRateLimiter({ limit: 5, windowMs: 60_000 }),
  // Keyed on client IP and spent only on a wrong PIN, because deviceId above
  // comes out of the request body and a guesser simply sends a new one.
  pinAttemptLimiter: createRateLimiter({ limit: 10, windowMs: 600_000 }),
  store: createSupabaseStore(env),
});

Deno.serve(handle);
