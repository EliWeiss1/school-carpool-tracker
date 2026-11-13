/**
 * Edge Function entrypoint: a school's settings, device codes and devices, and
 * creating a school.
 *
 * Thin on purpose. The decisions live in _shared/handlers/school-write.ts,
 * which knows nothing about Deno; this file only wires the runtime to it. It
 * passes no staff PIN and no PIN limiter: the PIN has no way into this function.
 */

import { createAccessStore } from "../_shared/access-store.deno.ts";
import { readEnv } from "../_shared/env.deno.ts";
import { createSchoolWriteHandler } from "../_shared/handlers/school-write.ts";
import { createRateLimiter } from "../_shared/rate-limit.ts";
import { createSchoolStore } from "../_shared/school-store.deno.ts";

const env = readEnv();

const handle = createSchoolWriteHandler({
  access: createAccessStore(env),
  schools: createSchoolStore(env),
  // Form submits from the office, same pace as the other write endpoints.
  rateLimiter: createRateLimiter({ limit: 30, windowMs: 60_000 }),
});

Deno.serve(handle);
