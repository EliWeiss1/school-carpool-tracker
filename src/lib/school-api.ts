/**
 * The typed client for the two account-based Edge Functions: `school-write`
 * (an office user managing their school) and `pair-device` (a phone or screen
 * joining a school with a code).
 *
 * Unlike the legacy clients these never send a PIN. The caller passes the
 * signed-in user's access token, which goes in the Authorization header only,
 * never in the body. Same transport and `ApiError` as `api.ts`, so a failure
 * reads the same way everywhere.
 */

import {
  type ApiClientOptions,
  compact,
  createEdgeFunctionPost,
  type RequestOptions,
} from "@/lib/api";

/** Present on every call: whose token, and which browser it came from. */
export interface SessionAuth extends RequestOptions {
  accessToken: string;
  deviceId: string;
}

export interface SchoolSummary {
  id: string;
  name: string;
  slug: string;
  timezone: string;
}

export interface SchoolSettings extends SchoolSummary {
  resetHour: number;
  resetDays: number[];
}

export type CodeTarget = "announce" | "display" | "both";

export interface SchoolDeviceInfo {
  id: string;
  label: string | null;
  canAnnounce: boolean;
  canDisplay: boolean;
  createdAt: string;
  lastSeenAt: string | null;
}

export interface CreateSchoolInput extends SessionAuth {
  name: string;
  slug: string;
  timezone: string;
}
export interface CreateSchoolResponse {
  school: SchoolSummary;
  /** False means this account already had a school, which is returned. */
  created: boolean;
}

export interface SchoolScoped extends SessionAuth {
  schoolId: string;
}

export interface UpdateSettingsInput extends SchoolScoped {
  name?: string;
  timezone?: string;
  resetHour?: number;
  resetDays?: number[];
}
export interface UpdateSettingsResponse {
  school: SchoolSettings;
}

export interface CodesResponse {
  announceCode: string | null;
  displayCode: string | null;
}

export interface SetCodeInput extends SchoolScoped {
  which: CodeTarget;
  code: string;
  disconnectDevices?: boolean;
}
export interface SetCodeResponse extends CodesResponse {
  disconnected: number;
}

export interface ListDevicesResponse {
  devices: SchoolDeviceInfo[];
}

export interface DisconnectDeviceInput extends SchoolScoped {
  deviceRowId: string;
}
export interface DisconnectDeviceResponse {
  disconnected: boolean;
}

export interface PairDeviceInput extends SessionAuth {
  schoolSlug: string;
  code: string;
  label?: string;
}
export interface PairDeviceResponse {
  school: { id: string; name: string; slug: string };
  canAnnounce: boolean;
  canDisplay: boolean;
}

export interface SchoolApiClient {
  createSchool(input: CreateSchoolInput): Promise<CreateSchoolResponse>;
  updateSettings(input: UpdateSettingsInput): Promise<UpdateSettingsResponse>;
  getCodes(input: SchoolScoped): Promise<CodesResponse>;
  setCode(input: SetCodeInput): Promise<SetCodeResponse>;
  listDevices(input: SchoolScoped): Promise<ListDevicesResponse>;
  disconnectDevice(
    input: DisconnectDeviceInput,
  ): Promise<DisconnectDeviceResponse>;
  pairDevice(input: PairDeviceInput): Promise<PairDeviceResponse>;
}

export function createSchoolApiClient(
  options: ApiClientOptions = {},
): SchoolApiClient {
  const post = createEdgeFunctionPost({
    ...options,
    // A 401/403 here means the account may not do this, not "wrong PIN".
    fallbackMessages: {
      pin: "You do not have access to that. Sign in again.",
      unavailable:
        "CarpoolCaller is not reachable right now. Try again shortly.",
      request: "That request could not be completed.",
      network: "Could not connect. Check the wifi, then try again.",
      ...options.fallbackMessages,
    },
  });

  /** One school-write call: the action plus whatever else it needs. */
  const write = <T>(
    { accessToken, deviceId, signal }: SessionAuth,
    fields: Record<string, unknown>,
  ) =>
    post<T>(
      "school-write",
      compact({ ...fields, deviceId }),
      signal,
      accessToken,
    );

  return {
    createSchool({ name, slug, timezone, ...auth }) {
      return write<CreateSchoolResponse>(auth, {
        action: "create",
        name,
        slug,
        timezone,
      });
    },

    updateSettings({
      schoolId,
      name,
      timezone,
      resetHour,
      resetDays,
      ...auth
    }) {
      return write<UpdateSettingsResponse>(auth, {
        action: "update-settings",
        schoolId,
        name,
        timezone,
        resetHour,
        resetDays,
      });
    },

    getCodes({ schoolId, ...auth }) {
      return write<CodesResponse>(auth, { action: "get-codes", schoolId });
    },

    setCode({ schoolId, which, code, disconnectDevices, ...auth }) {
      return write<SetCodeResponse>(auth, {
        action: "set-code",
        schoolId,
        which,
        code,
        disconnectDevices,
      });
    },

    listDevices({ schoolId, ...auth }) {
      return write<ListDevicesResponse>(auth, {
        action: "list-devices",
        schoolId,
      });
    },

    disconnectDevice({ schoolId, deviceRowId, ...auth }) {
      return write<DisconnectDeviceResponse>(auth, {
        action: "disconnect-device",
        schoolId,
        deviceRowId,
      });
    },

    pairDevice({ schoolSlug, code, label, accessToken, deviceId, signal }) {
      return post<PairDeviceResponse>(
        "pair-device",
        compact({ schoolSlug, code, label, deviceId }),
        signal,
        accessToken,
      );
    },
  };
}

/** The client the app uses. Env is read on the first call, not at import. */
export const schoolApi: SchoolApiClient = createSchoolApiClient();
