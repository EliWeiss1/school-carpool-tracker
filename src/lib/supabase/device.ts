"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { deviceId } from "@/lib/device-id";
import { publicEnv } from "@/lib/env";
import {
  schoolApi,
  type PairDeviceResponse,
  type SchoolApiClient,
} from "@/lib/school-api";

/**
 * The paired device's own Supabase session, kept apart from the office login.
 *
 * Its own `storageKey` is the whole point: the office login lives in cookies
 * and this lives in localStorage under a different name, so signing in to the
 * office on a browser that is also a paired kerb screen can never replace (or
 * sign out) the screen's session. `detectSessionInUrl` is off because auth
 * links belong to the office client, not to a device.
 */
export const DEVICE_STORAGE_KEY = "carpoolcaller-device";

let client: SupabaseClient | undefined;

export function getDeviceClient(): SupabaseClient {
  if (!client) {
    client = createClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
      auth: {
        storageKey: DEVICE_STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

/** The subset of the auth client these helpers use, so they test without one. */
export interface DeviceAuth {
  getSession(): Promise<{
    data: { session: { access_token: string } | null };
  }>;
  signInAnonymously(): Promise<{
    data: { session: { access_token: string } | null };
    error: { message: string } | null;
  }>;
}

/** The current device access token, or null if this browser has no session. */
export async function getDeviceAccessToken(
  auth: DeviceAuth = getDeviceClient().auth,
): Promise<string | null> {
  const { data } = await auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * The device token, signing in anonymously first if there is none. An
 * anonymous user is how a phone or screen gets an identity without anyone
 * typing a password; the school code is what then gives it access.
 */
export async function ensureDeviceSession(
  auth: DeviceAuth = getDeviceClient().auth,
): Promise<string> {
  const existing = await getDeviceAccessToken(auth);
  if (existing) return existing;

  const { data, error } = await auth.signInAnonymously();
  const token = data.session?.access_token;
  if (error || !token) {
    throw new Error(
      "Could not set this device up. Check the wifi, then try again.",
    );
  }
  return token;
}

export interface PairDeviceDeps {
  auth?: DeviceAuth;
  api?: Pick<SchoolApiClient, "pairDevice">;
  deviceId?: string;
}

/**
 * Joins this browser to a school with the code the office gave out. Failures
 * come back as the server's own `ApiError` sentence (a wrong code and an
 * unknown school read identically on purpose).
 */
export async function pairDevice(
  input: { schoolSlug: string; code: string; label?: string },
  deps: PairDeviceDeps = {},
): Promise<PairDeviceResponse> {
  const accessToken = await ensureDeviceSession(deps.auth);
  return (deps.api ?? schoolApi).pairDevice({
    ...input,
    accessToken,
    deviceId: deps.deviceId ?? deviceId(),
  });
}
