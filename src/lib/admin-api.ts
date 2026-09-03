/**
 * The typed client for the five roster-management Edge Functions /admin
 * calls: roster-list, roster-write, roster-delete, roster-import and
 * roster-reset.
 *
 * Deliberately its own module rather than an addition to `api.ts`: that file
 * is owned by the announce/display work, and every one of its exports (most
 * importantly `ApiError`, whose `.message` is what a staff member actually
 * reads) is reused here rather than redefined, so a wrong PIN or a throttled
 * request looks and behaves identically on every screen in the app.
 *
 * Same shape as `api.ts` throughout: no state, no React, `fetch` taken as a
 * constructor argument so the whole surface is testable with no network.
 */

import { ApiError, type ApiErrorKind } from "@/lib/api";
import { functionsBaseUrl, publicEnv } from "@/lib/env";
import type { Student } from "@/types/db";

/* -------------------------------------------------------------------------- */
/* Shared shapes                                                              */
/* -------------------------------------------------------------------------- */

/** Present on every request: the PIN is the only real authorization we have. */
export interface Credentials {
  pin: string;
  deviceId: string;
}

/** The optional narrowing /roster-list accepts, mirroring the announce endpoints. */
export interface RosterScope {
  grade?: string | null;
  classGroup?: string | null;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

/** The fields /admin can set on a student. Never `status` or `arrived_at" -- see roster-write.ts for why. */
export interface StudentFields {
  first_name: string;
  last_name: string;
  aliases?: string[];
  grade?: string | null;
  class_group?: string | null;
}

/* -------------------------------------------------------------------------- */
/* Per-endpoint request/response shapes                                       */
/* -------------------------------------------------------------------------- */

export type RosterListInput = Credentials & RosterScope & RequestOptions;

export interface RosterListResponse {
  students: Student[];
}

export type RosterCreateInput = Credentials & RequestOptions & StudentFields;

export type RosterUpdateInput = Credentials &
  RequestOptions & {
    studentId: string;
  } & Partial<StudentFields>;

export interface RosterWriteResponse {
  student: Student;
  /** False when this was an edit rather than a new roster entry. */
  created: boolean;
}

export type RosterDeleteInput = Credentials &
  RequestOptions & {
    studentId: string;
  };

export interface RosterDeleteResponse {
  deleted: boolean;
}

export type RosterImportInput = Credentials &
  RequestOptions & {
    /** Already validated by `csv-import.ts` and confirmed by a person. */
    students: StudentFields[];
  };

export interface RosterImportResponse {
  created: number;
  students: Student[];
}

export type RosterResetInput = Credentials & RequestOptions;

export interface RosterResetResponse {
  /** How many students actually moved from arrived to waiting. */
  reset: number;
  /** How many of those got an audit row written. Never a reason to retry. */
  logged: number;
}

/* -------------------------------------------------------------------------- */
/* Client                                                                      */
/* -------------------------------------------------------------------------- */

export interface AdminApiClient {
  listRoster(input: RosterListInput): Promise<RosterListResponse>;
  createStudent(input: RosterCreateInput): Promise<RosterWriteResponse>;
  updateStudent(input: RosterUpdateInput): Promise<RosterWriteResponse>;
  deleteStudent(input: RosterDeleteInput): Promise<RosterDeleteResponse>;
  importRoster(input: RosterImportInput): Promise<RosterImportResponse>;
  resetAllToWaiting(input: RosterResetInput): Promise<RosterResetResponse>;
}

export interface AdminApiClientOptions {
  /** Defaults to `functionsBaseUrl()`, read lazily so tests need no env. */
  baseUrl?: string;
  anonKey?: string;
  fetchImpl?: typeof fetch;
}

/** Drops undefined and null so the server sees an absent field, not a null. */
function compact(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) out[key] = value;
  }
  return out;
}

function kindForStatus(status: number): ApiErrorKind {
  if (status === 401 || status === 403) return "pin";
  if (status === 429) return "throttled";
  if (status >= 500) return "unavailable";
  return "request";
}

/** Mirrors api.ts's fallback table -- the admin screen has no speech step, so `speech` never applies here. */
const FALLBACK_MESSAGE: Record<ApiErrorKind, string> = {
  pin: "That PIN was not recognised. Check with the office.",
  throttled: "Too many requests just now. Wait a moment and try again.",
  speech: "Speech recognition is unavailable.",
  unavailable: "The board is not reachable right now. Try again shortly.",
  request: "That request could not be completed.",
  network: "Could not connect. Check the wifi, then try again.",
};

function retryAfterFrom(response: Response): number | null {
  const raw = response.headers.get("retry-after");
  if (raw === null) return null;
  const seconds = Number(raw.trim());
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : null;
}

async function readErrorMessage(response: Response): Promise<string | null> {
  try {
    const parsed: unknown = await response.json();
    if (typeof parsed === "object" && parsed !== null) {
      const message = (parsed as Record<string, unknown>).error;
      if (typeof message === "string" && message.trim() !== "") {
        return message.trim();
      }
    }
  } catch {
    // A non-JSON body is a proxy or gateway talking, not our function.
  }
  return null;
}

export function createAdminApiClient(
  options: AdminApiClientOptions = {},
): AdminApiClient {
  // Resolved per call, not at construction, so a missing env variable throws
  // where a screen can catch it and show one error banner rather than taking
  // down the whole page at import time.
  const resolveBaseUrl = () =>
    (options.baseUrl ?? functionsBaseUrl()).replace(/\/+$/, "");
  const resolveAnonKey = () => options.anonKey ?? publicEnv.supabaseAnonKey;

  async function post<T>(
    endpoint: string,
    body: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<T> {
    const doFetch = options.fetchImpl ?? fetch;

    let response: Response;
    try {
      response = await doFetch(`${resolveBaseUrl()}/${endpoint}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${resolveAnonKey()}`,
          apikey: resolveAnonKey(),
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (caught: unknown) {
      if (caught instanceof Error && caught.name === "AbortError") throw caught;
      throw new ApiError("network", 0, FALLBACK_MESSAGE.network);
    }

    if (!response.ok) {
      const kind = kindForStatus(response.status);
      const message = await readErrorMessage(response);
      throw new ApiError(
        kind,
        response.status,
        message ?? FALLBACK_MESSAGE[kind],
        retryAfterFrom(response),
      );
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiError(
        "unavailable",
        response.status,
        FALLBACK_MESSAGE.unavailable,
      );
    }
  }

  return {
    listRoster({ pin, deviceId, grade, classGroup, signal }) {
      return post<RosterListResponse>(
        "roster-list",
        compact({ pin, deviceId, grade, classGroup }),
        signal,
      );
    },

    createStudent({
      pin,
      deviceId,
      first_name,
      last_name,
      aliases,
      grade,
      class_group,
      signal,
    }) {
      return post<RosterWriteResponse>(
        "roster-write",
        compact({
          pin,
          deviceId,
          first_name,
          last_name,
          aliases,
          grade,
          class_group,
        }),
        signal,
      );
    },

    updateStudent({
      pin,
      deviceId,
      studentId,
      first_name,
      last_name,
      aliases,
      grade,
      class_group,
      signal,
    }) {
      // Not `compact()` here: that helper drops `null` along with
      // `undefined`, but an edit needs to say "clear this field" by sending
      // an explicit null, distinct from "leave it alone" by omitting the key
      // entirely. roster-write.ts's handler keys its partial-update logic off
      // which fields are *present* in the body, so `undefined` (not sent) and
      // `null` (sent, meaning clear) have to stay distinguishable here too.
      const body: Record<string, unknown> = { pin, deviceId, studentId };
      if (first_name !== undefined) body.first_name = first_name;
      if (last_name !== undefined) body.last_name = last_name;
      if (aliases !== undefined) body.aliases = aliases;
      if (grade !== undefined) body.grade = grade;
      if (class_group !== undefined) body.class_group = class_group;

      return post<RosterWriteResponse>("roster-write", body, signal);
    },

    deleteStudent({ pin, deviceId, studentId, signal }) {
      return post<RosterDeleteResponse>(
        "roster-delete",
        compact({ pin, deviceId, studentId }),
        signal,
      );
    },

    importRoster({ pin, deviceId, students, signal }) {
      return post<RosterImportResponse>(
        "roster-import",
        compact({ pin, deviceId, students }),
        signal,
      );
    },

    resetAllToWaiting({ pin, deviceId, signal }) {
      return post<RosterResetResponse>(
        "roster-reset",
        compact({ pin, deviceId }),
        signal,
      );
    },
  };
}

/** The client the admin screen uses. Env is read on the first call, not at import. */
export const adminApi: AdminApiClient = createAdminApiClient();
