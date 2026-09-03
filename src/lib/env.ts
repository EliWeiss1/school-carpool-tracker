/**
 * Env access in one place so a missing variable fails loudly at the call site
 * instead of surfacing later as an opaque Supabase 401.
 *
 * Only NEXT_PUBLIC_* values are readable from the browser. Anything secret
 * (Deepgram key, service-role key, staff PIN) is read by the Supabase Edge
 * Functions, never here.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

// Next.js inlines NEXT_PUBLIC_* only when referenced as a full static property
// access, so these cannot be looked up dynamically.
export const publicEnv = {
  get supabaseUrl() {
    return required(
      "NEXT_PUBLIC_SUPABASE_URL",
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    );
  },
  get supabaseAnonKey() {
    return required(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
  },
  /** When true the announce page fakes Deepgram instead of opening a socket. */
  get mockSpeech() {
    return process.env.NEXT_PUBLIC_MOCK_SPEECH === "true";
  },
};

/** Base URL for the project's Supabase Edge Functions. */
export function functionsBaseUrl(): string {
  const override = process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL;
  if (override) return override.replace(/\/$/, "");
  return `${publicEnv.supabaseUrl.replace(/\/$/, "")}/functions/v1`;
}
