/**
 * Edge Function entrypoint: add, remove or reorder a class on the
 * admin-editable class list.
 *
 * Thin on purpose. Everything worth testing lives in
 * _shared/handlers/classes-write.ts, which knows nothing about Deno; this
 * file only wires the runtime to it.
 */

import { readEnv } from "../_shared/env.deno.ts";
import { createClassesWriteHandler } from "../_shared/handlers/classes-write.ts";
import { createRateLimiter } from "../_shared/rate-limit.ts";
import { createSupabaseStore } from "../_shared/supabase-store.deno.ts";

const env = readEnv();

const handle = createClassesWriteHandler({
  staffPin: env.staffPin,
  // A form submit from the office, same pace as roster-write.
  rateLimiter: createRateLimiter({ limit: 30, windowMs: 60_000 }),
  // Keyed on client IP and spent only on a wrong PIN, same shared-budget
  // arithmetic every roster/carpool endpoint's index.ts explains (see
  // roster-delete/index.ts). Adding this ninth endpoint at the usual 3 would
  // have pushed the deployment-wide total from 48 to 51, over the 50
  // ceiling pin-budget.test.ts enforces -- so this one is 2, not 3. The
  // class list is edited far less often than the roster itself, so the
  // tighter allowance costs a legitimate admin nothing.
  pinAttemptLimiter: createRateLimiter({ limit: 2, windowMs: 600_000 }),
  store: createSupabaseStore(env),
});

Deno.serve(handle);
