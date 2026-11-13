/**
 * The SchoolStore backed by Postgres (through the service role) and the Auth
 * admin API.
 *
 * Deno-only, and not run locally (no Deno on the development machine): it is
 * kept to thin calls into the SQL functions in 20261113120000_school_functions
 * (whose behaviour is tested in PGlite) plus plain selects, so there is little
 * logic here to get wrong. Every query names the school explicitly.
 */

import { createClient } from "npm:@supabase/supabase-js@2.114.0";

import type { FunctionEnv } from "./env.deno.ts";
import { isUuid } from "./schools.ts";
import type {
  CodeTarget,
  CreateSchoolOutcome,
  DeviceSummary,
  PairDeviceInput,
  PairingTarget,
  SchoolCodes,
  SchoolSettings,
  SchoolStore,
  SettingsPatch,
} from "./school-ports.ts";

interface SchoolRow {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  reset_hour: number;
  reset_days: number[];
}

const SETTINGS_COLUMNS = "id, name, slug, timezone, reset_hour, reset_days";

function toSettings(row: SchoolRow): SchoolSettings {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    timezone: row.timezone,
    resetHour: row.reset_hour,
    resetDays: row.reset_days,
  };
}

export function createSchoolStore(env: FunctionEnv): SchoolStore {
  const client = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    async createSchool(input): Promise<CreateSchoolOutcome> {
      const { data, error } = await client.rpc("create_school", {
        p_user_id: input.userId,
        p_name: input.name,
        p_slug: input.slug,
        p_timezone: input.timezone,
      });
      if (error) throw error;
      return data as CreateSchoolOutcome;
    },

    async updateSettings(
      schoolId: string,
      patch: SettingsPatch,
    ): Promise<SchoolSettings | null> {
      const columns: Record<string, unknown> = {};
      if (patch.name !== undefined) columns.name = patch.name;
      if (patch.timezone !== undefined) columns.timezone = patch.timezone;
      if (patch.resetHour !== undefined) columns.reset_hour = patch.resetHour;
      if (patch.resetDays !== undefined) columns.reset_days = patch.resetDays;

      const { data, error } = await client
        .from("schools")
        .update(columns)
        .eq("id", schoolId)
        .select(SETTINGS_COLUMNS)
        .maybeSingle();
      if (error) throw error;
      return data ? toSettings(data as SchoolRow) : null;
    },

    async getCodes(schoolId: string): Promise<SchoolCodes> {
      const { data, error } = await client
        .from("school_secrets")
        .select("announce_code, display_code")
        .eq("school_id", schoolId)
        .maybeSingle();
      if (error) throw error;
      const row = data as {
        announce_code: string | null;
        display_code: string | null;
      } | null;
      return {
        announceCode: row?.announce_code ?? null,
        displayCode: row?.display_code ?? null,
      };
    },

    async setCode(
      schoolId: string,
      which: CodeTarget,
      code: string | null,
      disconnect: boolean,
    ) {
      const { data, error } = await client.rpc("set_school_code", {
        p_school_id: schoolId,
        p_which: which,
        p_code: code,
        p_disconnect: disconnect,
      });
      if (error) throw error;
      const result = data as {
        announce_code: string | null;
        display_code: string | null;
        disconnected_user_ids: string[];
      };
      return {
        announceCode: result.announce_code,
        displayCode: result.display_code,
        disconnectedUserIds: result.disconnected_user_ids,
      };
    },

    async listDevices(schoolId: string): Promise<DeviceSummary[]> {
      const { data, error } = await client
        .from("school_devices")
        .select(
          "id, label, can_announce, can_display, created_at, last_seen_at",
        )
        .eq("school_id", schoolId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (
        (data as {
          id: string;
          label: string | null;
          can_announce: boolean;
          can_display: boolean;
          created_at: string;
          last_seen_at: string | null;
        }[]) ?? []
      ).map((row) => ({
        id: row.id,
        label: row.label,
        canAnnounce: row.can_announce,
        canDisplay: row.can_display,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
      }));
    },

    async removeDevice(
      schoolId: string,
      deviceRowId: string,
    ): Promise<string | null> {
      // A malformed id would make Postgres throw; it matches nothing, so null.
      if (!isUuid(deviceRowId)) return null;
      const { data, error } = await client
        .from("school_devices")
        .delete()
        .eq("id", deviceRowId)
        .eq("school_id", schoolId)
        .select("user_id");
      if (error) throw error;
      const removed = (data ?? []) as { user_id: string }[];
      return removed[0]?.user_id ?? null;
    },

    async findSchoolForPairing(slug: string): Promise<PairingTarget | null> {
      const school = await client
        .from("schools")
        .select("id, name, slug")
        .eq("slug", slug)
        .maybeSingle();
      if (school.error) throw school.error;
      if (!school.data) return null;
      const { id, name } = school.data as { id: string; name: string };

      const secrets = await client
        .from("school_secrets")
        .select("announce_code, display_code, locked_until")
        .eq("school_id", id)
        .maybeSingle();
      if (secrets.error) throw secrets.error;
      const row = secrets.data as {
        announce_code: string | null;
        display_code: string | null;
        locked_until: string | null;
      } | null;

      return {
        id,
        name,
        slug,
        announceCode: row?.announce_code ?? null,
        displayCode: row?.display_code ?? null,
        lockedUntil: row?.locked_until ?? null,
      };
    },

    async notePairFailure(schoolId: string) {
      const { data, error } = await client.rpc("note_pair_failure", {
        p_school_id: schoolId,
      });
      if (error) throw error;
      const result = data as {
        failed_attempts: number;
        locked_until: string | null;
      };
      return {
        failedAttempts: result.failed_attempts,
        lockedUntil: result.locked_until,
      };
    },

    async pairDevice(input: PairDeviceInput): Promise<void> {
      const { error } = await client.rpc("pair_device", {
        p_school_id: input.schoolId,
        p_user_id: input.userId,
        p_can_announce: input.canAnnounce,
        p_can_display: input.canDisplay,
        p_label: input.label,
      });
      if (error) throw error;
    },

    async deleteDeviceUsers(userIds: string[]): Promise<number> {
      let deleted = 0;
      for (const userId of userIds) {
        try {
          // Look the user up first: only an anonymous (device) session may be
          // deleted here. An office account handed in by mistake is left alone.
          const found = await client.auth.admin.getUserById(userId);
          if (found.error || found.data.user?.is_anonymous !== true) continue;
          const result = await client.auth.admin.deleteUser(userId);
          if (!result.error) deleted++;
        } catch (error: unknown) {
          // One stuck session must not stop the rest being cleaned up.
          console.error("could not delete a device session", error);
        }
      }
      return deleted;
    },
  };
}
