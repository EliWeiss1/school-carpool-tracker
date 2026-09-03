"use client";

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
