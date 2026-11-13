/**
 * The AccessStore backed by Supabase Auth and the tenancy tables.
 *
 * Deno-only. It answers two questions and writes nothing: is this token a live
 * user, and what is that user to this school. Both queries name the user and
 * the school explicitly, which is why they live here and not behind the
 * school-scoped helpers in supabase-store.deno.ts.
 */

import { createClient } from "npm:@supabase/supabase-js@2.114.0";

import type {
  AccessStore,
  SchoolAccess,
  VerifiedUser,
} from "./access-ports.ts";
import type { FunctionEnv } from "./env.deno.ts";

export function createAccessStore(env: FunctionEnv): AccessStore {
  const client = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    async verifyToken(token: string): Promise<VerifiedUser | null> {
      // getUser asks the Auth server rather than checking the signature
      // locally. That costs a round trip, and buys the thing a local check
      // cannot give: a device the office disconnected stops working at once,
      // not when its token happens to expire.
      const { data, error } = await client.auth.getUser(token);
      if (error) {
        const status = (error as { status?: number }).status;
        // No status, or a 5xx, is the Auth server failing -- not the caller.
        if (status === undefined || status >= 500) throw error;
        return null;
      }
      const user = data.user;
      if (!user) return null;
      return {
        userId: user.id,
        isAnonymous: user.is_anonymous === true,
        emailConfirmed: Boolean(user.email_confirmed_at),
      };
    },

    async accessFor(
      userId: string,
      schoolId: string,
    ): Promise<SchoolAccess | null> {
      const member = await client
        .from("school_members")
        .select("role")
        .eq("school_id", schoolId)
        .eq("user_id", userId)
        .maybeSingle();
      if (member.error) throw member.error;
      if (member.data) {
        const role = (member.data as { role: string }).role;
        return { kind: "member", role: role === "owner" ? "owner" : "admin" };
      }

      const device = await client
        .from("school_devices")
        .select("can_announce, can_display")
        .eq("school_id", schoolId)
        .eq("user_id", userId)
        .maybeSingle();
      if (device.error) throw device.error;
      if (!device.data) return null;
      const row = device.data as {
        can_announce: boolean;
        can_display: boolean;
      };
      return {
        kind: "device",
        canAnnounce: row.can_announce === true,
        canDisplay: row.can_display === true,
      };
    },
  };
}
