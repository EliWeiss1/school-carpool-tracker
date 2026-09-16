/**
 * POST /classes-write — add, remove or reorder a class on the admin-editable
 * class list.
 *
 * One endpoint for all three actions, selected by an explicit `action`
 * field, the same way /carpool-write covers create/update/delete. Replaces
 * the old hardcoded `CLASS_GROUPS` array in `src/lib/classes.ts`: an admin
 * (often a parent volunteer who doesn't know the school's exact class names
 * ahead of time, e.g. an early-childhood program's own section names) can
 * now add a class from /admin instead of needing a code change.
 *
 * Never touches a student's `class_group` value: that column stays free
 * text (see the class_groups migration), so removing a class here only
 * removes it from future pickers -- a student already carrying that value
 * keeps it exactly as before.
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
    "listClassGroups" | "createClassGroup" | "removeClassGroup" | "reorderClassGroups"
  >;
}

const ACTIONS = ["create", "delete", "reorder"] as const;
type ClassAction = (typeof ACTIONS)[number];

/** A class list longer than this is almost certainly a mistake. */
const MAX_CLASSES = 100;

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

export function createClassesWriteHandler(deps: ClassesWriteHandlerDeps) {
  return async function handle(request: Request): Promise<Response> {
    const options = preflight(request);
    if (options) return options;

    const guard = await guardRequest(request, deps);
    if (!guard.ok) return guard.response;

    const action = readAction(guard.body.action);
    if (action === null) {
      return errorResponse(400, 'action must be "create", "delete" or "reorder".');
    }

    return await withStoreErrors(async () => {
      if (action === "delete") return await remove(deps, guard.body);
      if (action === "reorder") return await reorder(deps, guard.body);
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
    return errorResponse(
      409,
      `A class named "${name}" already exists.`,
    );
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

  const removed = await deps.store.removeClassGroup(classId);
  if (!removed) {
    return errorResponse(404, "That class no longer exists.");
  }
  return jsonResponse({ deleted: true });
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
