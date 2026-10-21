/**
 * POST /classes-write — manage the admin-editable class list and who is in it.
 *
 * One endpoint for every action, selected by an explicit `action` field, the
 * same way /carpool-write covers create/update/delete. It is the only home for
 * these because `pin-budget.test.ts` sums the wrong-PIN allowance across every
 * deployed function: a separate function per action would spend budget for no
 * security gain. An admin (often a parent volunteer who doesn't know the
 * school's exact class names ahead of time) adds a class here instead of
 * needing a code change.
 *
 * Classes are linked to students many-to-many, so two actions do reach
 * students -- but only their class *links*, never the students themselves:
 *
 * - `delete` retires a class. A student in another class simply loses this
 *   one. If some students would be left with no class at all, nothing is
 *   deleted and the answer is a 409 describing them, so the admin decides:
 *   resend with `moveToClassId` (every member, sole or not, joins that class
 *   first) or with `force` (sole members end up classless).
 * - `members` bulk-adds and bulk-removes students from one class, so putting a
 *   whole group into a class never means opening each student.
 *
 * Neither touches `status`, `arrived_at` or any other student column.
 */

import {
  errorResponse,
  jsonResponse,
  preflight,
  readString,
  withStoreErrors,
} from "../http.ts";
import type { RosterStore } from "../ports.ts";
import { type GuardDeps, guardRequest } from "./guard.ts";
import { MAX_NAME_LENGTH, nameTooLong } from "./roster-input.ts";

export interface ClassesWriteHandlerDeps extends GuardDeps {
  store: Pick<
    RosterStore,
    | "listClassGroups"
    | "createClassGroup"
    | "removeClassGroup"
    | "changeClassMembers"
    | "reorderClassGroups"
  >;
}

const ACTIONS = ["create", "delete", "reorder", "members"] as const;
type ClassAction = (typeof ACTIONS)[number];

/** A class list longer than this is almost certainly a mistake. */
const MAX_CLASSES = 100;

/** The most student ids one `members` list may carry. */
const MAX_MEMBER_IDS = 500;

const CLASS_GONE = "That class no longer exists.";

function readAction(value: unknown): ClassAction | null {
  return typeof value === "string" &&
    (ACTIONS as readonly string[]).includes(value)
    ? (value as ClassAction)
    : null;
}

/** Ordered ids for a reorder; anything not a non-empty string is dropped. */
function readOrderedIds(body: Record<string, unknown>): string[] | null {
  const raw = body.orderedIds;
  if (!Array.isArray(raw)) return null;

  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string" && entry.trim() !== "") out.push(entry);
    if (out.length >= MAX_CLASSES) break;
  }
  return out.length === 0 ? null : out;
}

/**
 * One list of student ids for a `members` call: blank and non-string entries
 * are dropped, repeats collapsed. Null when the list is over the cap -- a
 * silent truncation would apply half an edit, so the whole request is refused.
 */
function readStudentIds(
  body: Record<string, unknown>,
  field: string,
): string[] | null {
  const raw = body[field];
  if (!Array.isArray(raw)) return [];
  if (raw.length > MAX_MEMBER_IDS) return null;

  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (trimmed !== "") seen.add(trimmed);
  }
  return [...seen];
}

export function createClassesWriteHandler(deps: ClassesWriteHandlerDeps) {
  return async function handle(request: Request): Promise<Response> {
    const options = preflight(request);
    if (options) return options;

    const guard = await guardRequest(request, deps);
    if (!guard.ok) return guard.response;

    const action = readAction(guard.body.action);
    if (action === null) {
      return errorResponse(
        400,
        'action must be "create", "delete", "reorder" or "members".',
      );
    }

    return await withStoreErrors(async () => {
      if (action === "delete") return await remove(deps, guard.body);
      if (action === "reorder") return await reorder(deps, guard.body);
      if (action === "members") return await changeMembers(deps, guard.body);
      return await create(deps, guard.body);
    });
  };
}

async function create(
  deps: ClassesWriteHandlerDeps,
  body: Record<string, unknown>,
): Promise<Response> {
  const name = readString(body, "name");
  if (name === null) {
    return errorResponse(400, "A class needs a name.");
  }
  if (nameTooLong(name)) {
    return errorResponse(
      400,
      `That name is too long (limit ${MAX_NAME_LENGTH} characters).`,
    );
  }

  const existing = await deps.store.listClassGroups();
  if (existing.length >= MAX_CLASSES) {
    return errorResponse(
      400,
      `That is too many classes (max ${MAX_CLASSES}). Remove one before adding another.`,
    );
  }
  const alreadyExists = existing.some(
    (group) => group.name.toLowerCase() === name.toLowerCase(),
  );
  if (alreadyExists) {
    return errorResponse(409, `A class named "${name}" already exists.`);
  }

  const classGroup = await deps.store.createClassGroup({ name });
  return jsonResponse({ classGroup, created: true });
}

async function remove(
  deps: ClassesWriteHandlerDeps,
  body: Record<string, unknown>,
): Promise<Response> {
  const classId = readString(body, "classId");
  if (classId === null) {
    return errorResponse(400, "No class was chosen to remove.");
  }

  const moveToClassId = readString(body, "moveToClassId");
  const outcome = await deps.store.removeClassGroup(classId, {
    ...(moveToClassId !== null ? { moveToClassId } : {}),
    // Only a literal true forces; a truthy string from a sloppy client must
    // not strip students of their class.
    force: body.force === true,
  });

  switch (outcome.status) {
    case "deleted":
      return jsonResponse({ deleted: true, movedCount: outcome.movedCount });
    case "needs-decision": {
      const count = outcome.soleMemberCount;
      return jsonResponse(
        {
          error:
            count === 1
              ? "1 student is only in this class."
              : `${count} students are only in this class.`,
          memberCount: outcome.memberCount,
          soleMemberCount: count,
          soleMembers: outcome.soleMembers,
        },
        409,
      );
    }
    case "bad-target":
      return errorResponse(400, "Choose a different class to move them to.");
    case "not-found":
      return errorResponse(404, CLASS_GONE);
  }
}

async function changeMembers(
  deps: ClassesWriteHandlerDeps,
  body: Record<string, unknown>,
): Promise<Response> {
  const classId = readString(body, "classId");
  if (classId === null) {
    return errorResponse(400, "No class was chosen.");
  }

  const addIds = readStudentIds(body, "addStudentIds");
  const removeIds = readStudentIds(body, "removeStudentIds");
  if (addIds === null || removeIds === null) {
    return errorResponse(
      400,
      `That is too many students at once (max ${MAX_MEMBER_IDS} per list). Do it in smaller groups.`,
    );
  }
  if (addIds.length === 0 && removeIds.length === 0) {
    return errorResponse(400, "Choose at least one student to add or remove.");
  }

  const outcome = await deps.store.changeClassMembers(
    classId,
    addIds,
    removeIds,
  );
  if (outcome === null) {
    return errorResponse(404, CLASS_GONE);
  }
  return jsonResponse({
    memberCount: outcome.memberCount,
    ignoredIds: outcome.ignoredIds,
  });
}

async function reorder(
  deps: ClassesWriteHandlerDeps,
  body: Record<string, unknown>,
): Promise<Response> {
  const orderedIds = readOrderedIds(body);
  if (orderedIds === null) {
    return errorResponse(400, "No class order was sent.");
  }

  const classGroups = await deps.store.reorderClassGroups(orderedIds);
  return jsonResponse({ classGroups });
}
