/**
 * Pure helpers for talking to the class-membership database functions
 * (set_student_classes, change_class_members, remove_class_group).
 *
 * supabase-store.deno.ts only runs in Deno against a live database, so
 * everything about the rpc contract that does not need a database -- parsing
 * the jsonb the functions return, turning a Postgres error code into a
 * sentence, naming a set of class ids -- lives here, where Vitest can reach it.
 */

import { flattenClassNames } from "./class-embed.ts";
import { RequestError } from "./http.ts";
import type {
  ChangeMembersOutcome,
  ClassGroupRow,
  RemoveClassGroupOutcome,
  SoleMember,
} from "./ports.ts";

/** Shown verbatim to staff, so it says what happened and what to do next. */
export const COLLISION_MESSAGE =
  "That change collided with another one. Try again.";

/** The slice of a PostgREST error this module reads. */
export interface RpcErrorLike {
  code?: string;
  message: string;
}

/**
 * Builds the Error a store method throws for a failed rpc (or a failed write
 * to student_classes, which can fail on the same foreign key).
 *   40P01 deadlock / 40001 serialization -> the collision sentence (retrying
 *     is the right response, and the whole call already rolled back);
 *   23503 foreign key -> a class went away between the picker and the save;
 *   22P02 invalid text representation -> a malformed (non-uuid) class or
 *     student id: a 400 `RequestError`, since retrying cannot help and the
 *     raw Postgres text means nothing to staff;
 *   anything else -> `<action>: <postgres message>`.
 * Codes the caller handles itself (P0002, 22023) must be checked before
 * calling this.
 */
export function classWriteFailure(error: RpcErrorLike, action: string): Error {
  if (error.code === "40P01" || error.code === "40001") {
    return new Error(COLLISION_MESSAGE);
  }
  if (error.code === "23503") {
    return new Error(
      "One of those classes no longer exists. Reload the page and try again.",
    );
  }
  if (error.code === "22P02") {
    return new RequestError(
      "That class or student could not be found. Reload the page and try again.",
      400,
    );
  }
  return new Error(`${action}: ${error.message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSoleMember(value: unknown): value is SoleMember {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.first_name === "string" &&
    typeof value.last_name === "string"
  );
}

/** remove_class_group()'s jsonb -> the port's outcome. Throws on a surprise. */
export function parseRemoveClassGroupResult(
  data: unknown,
): RemoveClassGroupOutcome {
  const shapeError = new Error(
    "remove_class_group returned an unexpected result -- the database function no longer matches this code.",
  );
  if (!isRecord(data)) throw shapeError;

  if (data.deleted === true) {
    if (typeof data.moved_count !== "number") throw shapeError;
    return { status: "deleted", movedCount: data.moved_count };
  }

  if (
    data.deleted === false &&
    typeof data.member_count === "number" &&
    typeof data.sole_member_count === "number" &&
    Array.isArray(data.sole_members) &&
    data.sole_members.every(isSoleMember)
  ) {
    return {
      status: "needs-decision",
      memberCount: data.member_count,
      soleMemberCount: data.sole_member_count,
      soleMembers: data.sole_members.map((member) => ({
        id: member.id,
        first_name: member.first_name,
        last_name: member.last_name,
      })),
    };
  }

  throw shapeError;
}

/** change_class_members()'s jsonb -> the port's outcome. Throws on a surprise. */
export function parseChangeMembersResult(data: unknown): ChangeMembersOutcome {
  if (
    isRecord(data) &&
    typeof data.member_count === "number" &&
    Array.isArray(data.ignored_ids) &&
    data.ignored_ids.every((id): id is string => typeof id === "string")
  ) {
    return { memberCount: data.member_count, ignoredIds: data.ignored_ids };
  }
  throw new Error(
    "change_class_members returned an unexpected result -- the database function no longer matches this code.",
  );
}

/**
 * The names for a set of class ids, in class sort_order. Ids not in `groups`
 * are skipped (a foreign key rejects them before this is ever used for a
 * stored row). Reuses flattenClassNames so there is one ordering rule.
 */
export function classNamesFor(
  groups: readonly ClassGroupRow[],
  ids: readonly string[],
): string[] {
  const wanted = new Set(ids);
  return flattenClassNames(
    groups
      .filter((group) => wanted.has(group.id))
      .map((group) => ({
        class_groups: { name: group.name, sort_order: group.sort_order },
      })),
  );
}
