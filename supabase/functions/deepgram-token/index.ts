/**
 * Edge Function entrypoint: mint a Deepgram token for one announce session.
 *
 * Thin on purpose. Everything worth testing lives in _shared/handlers/token.ts,
 * which knows nothing about Deno; this file only wires the runtime to it.
 */

import { mintDeepgramToken } from "../_shared/deepgram.ts";
import { readEnv } from "../_shared/env.deno.ts";
import { createTokenHandler } from "../_shared/handlers/token.ts";
import { createRateLimiter } from "../_shared/rate-limit.ts";
import { createSupabaseStore } from "../_shared/supabase-store.deno.ts";

const env = readEnv();

const handle = createTokenHandler({
  staffPin: env.staffPin,
  // A session token lasts minutes, so a device needs one only now and then.
  rateLimiter: createRateLimiter({ limit: 20, windowMs: 60_000 }),
  // Keyed on client IP and spent only on a wrong PIN, because deviceId above
  // comes out of the request body and a guesser simply sends a new one.
  pinAttemptLimiter: createRateLimiter({ limit: 10, windowMs: 600_000 }),
  store: createSupabaseStore(env),
  mintToken: () =>
    mintDeepgramToken({ apiKey: env.deepgramApiKey, mock: env.mockSpeech }),
});

Deno.serve(handle);
