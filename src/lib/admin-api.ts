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
  ApiError,
  type ApiClientOptions,
  bearerOf,
  compact,
  createEdgeFunctionPost,
  credentialFields,
  type Credentials,
} from "@/lib/api";
import type { Carpool, ClassGroup, StudentWithClasses } from "@/types/db";
import type { CsvImportStudent } from "@/lib/csv-import";

/* -------------------------------------------------------------------------- */
/* Shared shapes                                                              */
/* -------------------------------------------------------------------------- */

/** Who is calling: the legacy PIN, or a signed-in session. See `Credentials` in api.ts. */
export type { Credentials } from "@/lib/api";

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
  /** Class names. On update, omit to leave classes alone; `[]` removes them all. */
  class_groups?: string[];
  carpool_id?: string | null;
  /** Up to two parent/guardian names, for admin identification and voice-match resolution. Stored separately from every other student field -- see the parent_names migration. */
  parent1_name?: string | null;
  parent2_name?: string | null;
}

/**
 * A student as /admin sees it: every public field, plus parent names --
 * which are never returned to /display or /announce (see `resolve.ts`'s
 * `candidateStudent()`), only to the PIN-gated roster-list/roster-write
 * responses this type describes.
 */
export type RosterStudent = StudentWithClasses & {
  parent1_name: string | null;
  parent2_name: string | null;
};

/* -------------------------------------------------------------------------- */
/* Per-endpoint request/response shapes                                       */
/* -------------------------------------------------------------------------- */

export type RosterListInput = Credentials & RosterScope & RequestOptions;

export interface RosterListResponse {
  students: RosterStudent[];
  carpools: Carpool[];
  /** Class id -> how many students are in it. A class with none may be absent. */
  classMemberCounts: Record<string, number>;
}

export type RosterCreateInput = Credentials & RequestOptions & StudentFields;

export type RosterUpdateInput = Credentials &
  RequestOptions & {
    studentId: string;
  } & Partial<StudentFields>;

export interface RosterWriteResponse {
  student: RosterStudent;
  /** False when this was an edit rather than a new roster entry. */
  created: boolean;
}

export type RosterDeleteInput = Credentials &
  RequestOptions & {
    studentId: string;
  };

/** The bulk form: a select-and-delete from the roster table, or the ids a
 *  just-confirmed import created (for "Undo import"). */
export type RosterDeleteManyInput = Credentials &
  RequestOptions & {
    studentIds: string[];
  };

export interface RosterDeleteResponse {
  /** Ids that existed and were removed. */
  deletedIds: string[];
  /** Ids that were already gone -- never a reason to treat the call as failed. */
  missingIds: string[];
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
  students: StudentWithClasses[];
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
  members: StudentWithClasses[];
  created: boolean;
}

export interface CarpoolDeleteResponse {
  deleted: boolean;
}

/* -------------------------------------------------------------------------- */
/* Class list                                                                  */
/* -------------------------------------------------------------------------- */

export type ClassCreateInput = Credentials &
  RequestOptions & {
    name: string;
  };

export type ClassDeleteInput = Credentials &
  RequestOptions & {
    classId: string;
    /** Every member joins this class first, so nobody is left classless. */
    moveToClassId?: string;
    /** Delete anyway; students only in this class end up with no class. */
    force?: boolean;
  };

export type ClassReorderInput = Credentials &
  RequestOptions & {
    orderedIds: string[];
  };

export interface ClassWriteResponse {
  classGroup: ClassGroup;
  created: boolean;
}

export interface ClassDeleteResponse {
  deleted: true;
  /** How many students were moved to `moveToClassId` (0 when none was given). */
  movedCount: number;
}

/**
 * The 409 body from deleting a class that would leave students classless.
 * `deleteClass` rejects with an `ApiError` of kind "conflict" whose `details`
 * has this shape; `classDeleteDecision` reads it back out type-safely.
 */
export interface ClassDeleteNeedsDecision {
  memberCount: number;
  soleMemberCount: number;
  soleMembers: { id: string; first_name: string; last_name: string }[];
}

/**
 * Narrows an error to the class-delete decision payload, or null for any other
 * failure (wrong PIN, class already gone...). Checks the shape rather than
 * casting, because `details` is whatever the server sent.
 */
export function classDeleteDecision(
  error: unknown,
): ClassDeleteNeedsDecision | null {
  if (!(error instanceof ApiError) || error.kind !== "conflict") return null;
  const d = error.details;
  if (
    d === null ||
    typeof d.memberCount !== "number" ||
    typeof d.soleMemberCount !== "number" ||
    !Array.isArray(d.soleMembers)
  ) {
    return null;
  }
  return {
    memberCount: d.memberCount,
    soleMemberCount: d.soleMemberCount,
    soleMembers: d.soleMembers as ClassDeleteNeedsDecision["soleMembers"],
  };
}

export type ClassMembersInput = Credentials &
  RequestOptions & {
    classId: string;
    addStudentIds?: string[];
    removeStudentIds?: string[];
  };

export interface ClassMembersResponse {
  /** Students in the class after the change. */
  memberCount: number;
  /** Ids that were not students (already deleted); never a reason to fail. */
  ignoredIds: string[];
}

export interface ClassReorderResponse {
  classGroups: ClassGroup[];
}

/* -------------------------------------------------------------------------- */
/* Client                                                                      */
/* -------------------------------------------------------------------------- */

export interface AdminApiClient {
  listRoster(input: RosterListInput): Promise<RosterListResponse>;
  createStudent(input: RosterCreateInput): Promise<RosterWriteResponse>;
  updateStudent(input: RosterUpdateInput): Promise<RosterWriteResponse>;
  deleteStudent(input: RosterDeleteInput): Promise<RosterDeleteResponse>;
  deleteStudents(input: RosterDeleteManyInput): Promise<RosterDeleteResponse>;
  importRoster(input: RosterImportInput): Promise<RosterImportResponse>;
  resetAllToWaiting(input: RosterResetInput): Promise<RosterResetResponse>;
  createCarpool(input: CarpoolCreateInput): Promise<CarpoolWriteResponse>;
  updateCarpool(input: CarpoolUpdateInput): Promise<CarpoolWriteResponse>;
  deleteCarpool(input: CarpoolDeleteInput): Promise<CarpoolDeleteResponse>;
  createClass(input: ClassCreateInput): Promise<ClassWriteResponse>;
  deleteClass(input: ClassDeleteInput): Promise<ClassDeleteResponse>;
  reorderClasses(input: ClassReorderInput): Promise<ClassReorderResponse>;
  changeClassMembers(input: ClassMembersInput): Promise<ClassMembersResponse>;
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
    listRoster({ classGroup, signal, ...credentials }) {
      return post<RosterListResponse>(
        "roster-list",
        compact({ ...credentialFields(credentials), classGroup }),
        signal,
        bearerOf(credentials),
      );
    },

    createStudent({
      first_name,
      last_name,
      aliases,
      class_groups,
      carpool_id,
      parent1_name,
      parent2_name,
      signal,
      ...credentials
    }) {
      return post<RosterWriteResponse>(
        "roster-write",
        compact({
          ...credentialFields(credentials),
          first_name,
          last_name,
          aliases,
          class_groups,
          carpool_id,
          parent1_name,
          parent2_name,
        }),
        signal,
        bearerOf(credentials),
      );
    },

    updateStudent({
      studentId,
      first_name,
      last_name,
      aliases,
      class_groups,
      carpool_id,
      parent1_name,
      parent2_name,
      signal,
      ...credentials
    }) {
      // Not `compact()` here: that helper drops `null` along with
      // `undefined`, but an edit needs to say "clear this field" by sending
      // an explicit null, distinct from "leave it alone" by omitting the key
      // entirely. roster-write.ts's handler keys its partial-update logic off
      // which fields are *present* in the body, so `undefined` (not sent) and
      // an explicit value (`null`, or `[]` for class_groups) have to stay
      // distinguishable here too.
      const body: Record<string, unknown> = {
        ...credentialFields(credentials),
        studentId,
      };
      if (first_name !== undefined) body.first_name = first_name;
      if (last_name !== undefined) body.last_name = last_name;
      if (aliases !== undefined) body.aliases = aliases;
      if (class_groups !== undefined) body.class_groups = class_groups;
      if (carpool_id !== undefined) body.carpool_id = carpool_id;
      if (parent1_name !== undefined) body.parent1_name = parent1_name;
      if (parent2_name !== undefined) body.parent2_name = parent2_name;

      return post<RosterWriteResponse>(
        "roster-write",
        body,
        signal,
        bearerOf(credentials),
      );
    },

    deleteStudent({ studentId, signal, ...credentials }) {
      return post<RosterDeleteResponse>(
        "roster-delete",
        compact({ ...credentialFields(credentials), studentId }),
        signal,
        bearerOf(credentials),
      );
    },

    deleteStudents({ studentIds, signal, ...credentials }) {
      return post<RosterDeleteResponse>(
        "roster-delete",
        compact({ ...credentialFields(credentials), studentIds }),
        signal,
        bearerOf(credentials),
      );
    },

    importRoster({ students, signal, ...credentials }) {
      return post<RosterImportResponse>(
        "roster-import",
        compact({ ...credentialFields(credentials), students }),
        signal,
        bearerOf(credentials),
      );
    },

    resetAllToWaiting({ signal, ...credentials }) {
      return post<RosterResetResponse>(
        "roster-reset",
        compact({ ...credentialFields(credentials) }),
        signal,
        bearerOf(credentials),
      );
    },

    createCarpool({ name, aliases, memberIds, signal, ...credentials }) {
      return post<CarpoolWriteResponse>(
        "carpool-write",
        compact({
          ...credentialFields(credentials),
          action: "create",
          name,
          aliases,
          memberIds,
        }),
        signal,
        bearerOf(credentials),
      );
    },

    updateCarpool({
      carpoolId,
      name,
      aliases,
      memberIds,
      signal,
      ...credentials
    }) {
      // Not `compact()` for the same reason as updateStudent: `memberIds: []`
      // (clear every member) has to survive, and compact() would drop it as
      // falsy-looking only if it dropped empty arrays too -- it does not, but
      // `name`/`aliases` still need the "field present vs. absent" distinction
      // roster-write.ts's pattern relies on, so this stays explicit rather
      // than reaching for compact() out of habit.
      const body: Record<string, unknown> = {
        ...credentialFields(credentials),
        action: "update",
        carpoolId,
      };
      if (name !== undefined) body.name = name;
      if (aliases !== undefined) body.aliases = aliases;
      if (memberIds !== undefined) body.memberIds = memberIds;

      return post<CarpoolWriteResponse>(
        "carpool-write",
        body,
        signal,
        bearerOf(credentials),
      );
    },

    deleteCarpool({ carpoolId, signal, ...credentials }) {
      return post<CarpoolDeleteResponse>(
        "carpool-write",
        compact({
          ...credentialFields(credentials),
          action: "delete",
          carpoolId,
        }),
        signal,
        bearerOf(credentials),
      );
    },

    createClass({ name, signal, ...credentials }) {
      return post<ClassWriteResponse>(
        "classes-write",
        compact({ ...credentialFields(credentials), action: "create", name }),
        signal,
        bearerOf(credentials),
      );
    },

    deleteClass({ classId, moveToClassId, force, signal, ...credentials }) {
      // compact() drops undefined/null, so an unset moveToClassId or force
      // never reaches the wire.
      return post<ClassDeleteResponse>(
        "classes-write",
        compact({
          ...credentialFields(credentials),
          action: "delete",
          classId,
          moveToClassId,
          force,
        }),
        signal,
        bearerOf(credentials),
      );
    },

    reorderClasses({ orderedIds, signal, ...credentials }) {
      return post<ClassReorderResponse>(
        "classes-write",
        compact({
          ...credentialFields(credentials),
          action: "reorder",
          orderedIds,
        }),
        signal,
        bearerOf(credentials),
      );
    },

    changeClassMembers({
      classId,
      addStudentIds,
      removeStudentIds,
      signal,
      ...credentials
    }) {
      return post<ClassMembersResponse>(
        "classes-write",
        compact({
          ...credentialFields(credentials),
          action: "members",
          classId,
          addStudentIds,
          removeStudentIds,
        }),
        signal,
        bearerOf(credentials),
      );
    },
  };
}

/** The client the admin screen uses. Env is read on the first call, not at import. */
export const adminApi: AdminApiClient = createAdminApiClient();
