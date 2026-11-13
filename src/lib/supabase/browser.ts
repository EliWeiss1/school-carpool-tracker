"use client";

import { createBrowserClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import type { Database } from "@/types/db";

let client: SupabaseClient<Database> | undefined;

/**
 * Anon-key client for the browser. Read-only by design: RLS grants `select` on
 * `students` and nothing else, so every write goes through an Edge Function.
 * Memoised because each `createClient` call opens its own realtime socket.
 */
export function getBrowserClient(): SupabaseClient<Database> {
  if (!client) {
    client = createClient<Database>(
      publicEnv.supabaseUrl,
      publicEnv.supabaseAnonKey,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        realtime: { params: { eventsPerSecond: 10 } },
      },
    );
  }
  return client;
}

let officeClient: SupabaseClient<Database> | undefined;

/**
 * The office user's client for the sign-up and sign-in pages. Its session lives
 * in cookies so server components (and middleware) can read it. Separate from
 * `getBrowserClient`, which the kerb screens use with no session at all.
 */
export function getOfficeBrowserClient(): SupabaseClient<Database> {
  officeClient ??= createBrowserClient<Database>(
    publicEnv.supabaseUrl,
    publicEnv.supabaseAnonKey,
  );
  return officeClient;
}
