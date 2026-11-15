/**
 * The VoiceUsageStore backed by Postgres through the service role.
 *
 * Deno-only, and not run locally (no Deno on the development machine): two
 * thin rpc calls into claim_voice_session and school_voice_usage
 * (20261114120000_per_school_behaviour), whose behaviour is tested in PGlite.
 * They name the school explicitly and are not roster queries, which is why
 * they sit beside access-store.deno.ts rather than in supabase-store.deno.ts.
 */

import { createClient } from "npm:@supabase/supabase-js@2.114.0";

import type { FunctionEnv } from "./env.deno.ts";
import type { VoiceClaim, VoiceUsage, VoiceUsageStore } from "./usage-ports.ts";

interface ClaimJson {
  allowed: boolean;
  reason?: "disabled" | "limit";
  used?: number;
  limit?: number | null;
}

interface UsageJson {
  used: number;
  limit: number | null;
  enabled: boolean;
}

export function createVoiceUsageStore(env: FunctionEnv): VoiceUsageStore {
  const client = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    async claimVoiceSession(schoolId: string): Promise<VoiceClaim> {
      const { data, error } = await client.rpc("claim_voice_session", {
        p_school_id: schoolId,
      });
      if (error) throw error;
      const claim = data as ClaimJson | null;
      if (!claim) throw new Error("claim_voice_session returned nothing.");
      if (claim.allowed) {
        return {
          allowed: true,
          used: claim.used ?? 0,
          limit: claim.limit ?? null,
        };
      }
      return {
        allowed: false,
        reason: claim.reason === "limit" ? "limit" : "disabled",
      };
    },

    async voiceUsage(schoolId: string): Promise<VoiceUsage> {
      const { data, error } = await client.rpc("school_voice_usage", {
        p_school_id: schoolId,
      });
      if (error) throw error;
      const usage = data as UsageJson | null;
      // An unknown school: report voice off rather than inventing numbers.
      if (!usage) return { used: 0, limit: null, enabled: false };
      return {
        used: usage.used,
        limit: usage.limit,
        enabled: usage.enabled,
      };
    },
  };
}
