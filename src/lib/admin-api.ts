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

import {
  type ApiClientOptions,
  compact,
  createEdgeFunctionPost,
} from "@/lib/api";
import type { Carpool, Student } from "@/types/db";
import type { CsvImportStudent } from "@/lib/csv-import";

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
  class_group?: string | null;
  carpool_id?: string | null;
}

/* -------------------------------------------------------------------------- */
/* Per-endpoint request/response shapes                                       */
/* -------------------------------------------------------------------------- */

export type RosterListInput = Credentials & RosterScope & RequestOptions;

export interface RosterListResponse {
  students: Student[];
  carpools: Carpool[];
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
    /**
     * Already validated by `csv-import.ts` and confirmed by a person. Carries
     * `carpool` (a name, not an id) rather than `StudentFields`' `carpool_id`
     * -- the server resolves each name to a carpool, creating one if it does
     * not already exist, since the file is the only place these names exist
     * before the import runs.
     */
    students: CsvImportStudent[];
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
/* Carpools                                                                    */
/* -------------------------------------------------------------------------- */

export type CarpoolCreateInput = Credentials &
  RequestOptions & {
    name: string;
    aliases?: string[];
    memberIds?: string[];
  };

export type CarpoolUpdateInput = Credentials &
  RequestOptions & {
    carpoolId: string;
    name?: string;
    aliases?: string[];
    /** The WHOLE desired membership when sent -- omit to leave membership untouched. */
    memberIds?: string[];
  };

export type CarpoolDeleteInput = Credentials &
  RequestOptions & {
    carpoolId: string;
  };

export interface CarpoolWriteResponse {
  carpool: Carpool;
  members: Student[];
  created: boolean;
}

export interface CarpoolDeleteResponse {
  deleted: boolean;
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
  createCarpool(input: CarpoolCreateInput): Promise<CarpoolWriteResponse>;
  updateCarpool(input: CarpoolUpdateInput): Promise<CarpoolWriteResponse>;
  deleteCarpool(input: CarpoolDeleteInput): Promise<CarpoolDeleteResponse>;
}

/**
 * The admin client uses the app's shared client options and, crucially, its
 * shared transport. It used to carry its own copy of both -- and the copy also
 * carried a bug that had already been fixed in api.ts, reporting an
 * unconfigured deployment as "check the wifi". One transport, one set of error
 * semantics, one place to fix them.
 */
export type AdminApiClientOptions = ApiClientOptions;

export function createAdminApiClient(
  options: AdminApiClientOptions = {},
): AdminApiClient {
  const post = createEdgeFunctionPost({
    ...options,
    // Same transport, different room. Nobody in the office can "type the name
    // instead", and a 502 here is Supabase's gateway, not the speech service.
    fallbackMessages: {
      speech: "The board is not reachable right now. Try again shortly.",
      unavailable: "The board is not reachable right now. Try again shortly.",
      request: "That request could not be completed.",
      network: "Could not connect. Check the wifi, then try again.",
      ...options.fallbackMessages,
    },
  });

  return {
    listRoster({ pin, deviceId, classGroup, signal }) {
      return post<RosterListResponse>(
        "roster-list",
        compact({ pin, deviceId, classGroup }),
        signal,
      );
    },

    createStudent({
      pin,
      deviceId,
      first_name,
      last_name,
      aliases,
      class_group,
      carpool_id,
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
          class_group,
          carpool_id,
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
      class_group,
      carpool_id,
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
      if (class_group !== undefined) body.class_group = class_group;
      if (carpool_id !== undefined) body.carpool_id = carpool_id;

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

    createCarpool({ pin, deviceId, name, aliases, memberIds, signal }) {
      return post<CarpoolWriteResponse>(
        "carpool-write",
        compact({ pin, deviceId, action: "create", name, aliases, memberIds }),
        signal,
      );
    },

    updateCarpool({
      pin,
      deviceId,
      carpoolId,
      name,
      aliases,
      memberIds,
      signal,
    }) {
      // Not `compact()` for the same reason as updateStudent: `memberIds: []`
      // (clear every member) has to survive, and compact() would drop it as
      // falsy-looking only if it dropped empty arrays too -- it does not, but
      // `name`/`aliases` still need the "field present vs. absent" distinction
      // roster-write.ts's pattern relies on, so this stays explicit rather
      // than reaching for compact() out of habit.
      const body: Record<string, unknown> = {
        pin,
        deviceId,
        action: "update",
        carpoolId,
      };
      if (name !== undefined) body.name = name;
      if (aliases !== undefined) body.aliases = aliases;
      if (memberIds !== undefined) body.memberIds = memberIds;

      return post<CarpoolWriteResponse>("carpool-write", body, signal);
    },

    deleteCarpool({ pin, deviceId, carpoolId, signal }) {
      return post<CarpoolDeleteResponse>(
        "carpool-write",
        compact({ pin, deviceId, action: "delete", carpoolId }),
        signal,
      );
    },
  };
}

/** The client the admin screen uses. Env is read on the first call, not at import. */
export const adminApi: AdminApiClient = createAdminApiClient();
