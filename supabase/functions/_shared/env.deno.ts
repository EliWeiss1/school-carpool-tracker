/**
 * The one place an Edge Function reads its environment.
 *
 * Deno-only (hence the .deno.ts suffix, which keeps it out of the Next.js
 * typecheck): everything above this file takes its configuration as arguments,
 * which is what lets the handlers be tested without a runtime at all.
 *
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
 * DEEPGRAM_API_KEY, STAFF_PIN and MOCK_SPEECH are set with
 * `npx supabase secrets set` (or in the project's Edge Function settings).
 */

export interface FunctionEnv {
  supabaseUrl: string;
  serviceRoleKey: string;
  staffPin: string | undefined;
  deepgramApiKey: string | undefined;
  /** When true, no Deepgram call is made and a canned token is returned. */
  mockSpeech: boolean;
}

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    // Thrown at module load, so the function fails to start rather than failing
    // one request at a time in a way nobody notices until pickup.
    throw new Error(`Missing environment variable ${name}.`);
  }
  return value;
}

export function readEnv(): FunctionEnv {
  return {
    supabaseUrl: required("SUPABASE_URL"),
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
    // Not `required`: a missing PIN must reject every request (see pin.ts),
    // not stop the function from booting, or a typo would take the board down.
    staffPin: Deno.env.get("STAFF_PIN"),
    deepgramApiKey: Deno.env.get("DEEPGRAM_API_KEY"),
    mockSpeech: Deno.env.get("MOCK_SPEECH") === "true",
  };
}
