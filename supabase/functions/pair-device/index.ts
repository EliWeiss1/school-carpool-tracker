/**
 * Edge Function entrypoint: connect a phone or board to a school with a code.
 *
 * Thin on purpose. The decisions live in _shared/handlers/pair-device.ts, which
 * knows nothing about Deno; this file only wires the runtime to it. It passes no
 * staff PIN and no PIN limiter: the PIN has no way into this function.
 */

import { createAccessStore } from "../_shared/access-store.deno.ts";
import { readEnv } from "../_shared/env.deno.ts";
import { createPairDeviceHandler } from "../_shared/handlers/pair-device.ts";
import { createRateLimiter } from "../_shared/rate-limit.ts";
import { createSchoolStore } from "../_shared/school-store.deno.ts";

const env = readEnv();

const handle = createPairDeviceHandler({
  access: createAccessStore(env),
  schools: createSchoolStore(env),
  // A person typing a code once; this only stops a stuck client looping.
  rateLimiter: createRateLimiter({ limit: 20, windowMs: 60_000 }),
  // Keyed on client IP and spent only on a wrong code: five wrong codes in ten
  // minutes from one network, then it waits. Per isolate, so best effort; the
  // per-school counter in the database is what holds across isolates.
  codeAttemptLimiter: createRateLimiter({ limit: 5, windowMs: 600_000 }),
});

Deno.serve(handle);
