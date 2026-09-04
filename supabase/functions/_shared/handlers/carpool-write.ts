/**
 * POST /carpool-write — create, edit or delete a carpool and set its members.
 *
 * One endpoint for all three actions, selected by an explicit `action` field,
 * the same way /roster-write covers both create and update by branching on
 * whether `studentId` was sent. Splitting this into carpool-write +
 * carpool-delete (mirroring roster-write/roster-delete) would cost another
 * slice of the shared PIN-guessing budget (see pin-budget.test.ts) for no
 * security benefit -- carpool setup and edits come from the same office
 * computer as every other roster-write action.
 *
 * Deleting a carpool never deletes or removes a student from the roster: the
 * FK on students.carpool_id is `on delete set null`, so members are simply
 * unlinked (see the migration).
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
import { MAX_NAME_LENGTH, nameTooLong, readAliases } from "./roster-input.ts";

export interface CarpoolWriteHandlerDeps extends GuardDeps {
  store: Pick<
    RosterStore,
    | "list"
    | "listCarpools"
    | "createCarpool"
    | "updateCarpool"
    | "removeCarpool"
    | "setCarpoolMembers"
  >;
}

const ACTIONS = ["create", "update", "delete"] as const;
type CarpoolAction = (typeof ACTIONS)[number];

/** A carpool with more than this many members is almost certainly a mistake. */
const MAX_MEMBERS = 20;

function readAction(value: unknown): CarpoolAction | null {
  return typeof value === "string" &&
    (ACTIONS as readonly string[]).includes(value)
    ? (value as CarpoolAction)
    : null;
}

/** Member ids arrive as a JSON array of strings; anything else is dropped. */
function readMemberIds(body: Record<string, unknown>): string[] | null {
  if (!("memberIds" in body)) return null;
  const raw = body.memberIds;
  if (!Array.isArray(raw)) return [];

  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string" && entry.trim() !== "") out.push(entry);
    if (out.length >= MAX_MEMBERS) break;
  }
  return out;
}

export function createCarpoolWriteHandler(deps: CarpoolWriteHandlerDeps) {
  return async function handle(request: Request): Promise<Response> {
    const options = preflight(request);
    if (options) return options;

    const guard = await guardRequest(request, deps);
    if (!guard.ok) return guard.response;

    const action = readAction(guard.body.action);
    if (action === null) {
      return errorResponse(
        400,
        'action must be "create", "update" or "delete".',
      );
    }

    return await withStoreErrors(async () => {
      if (action === "delete") return await remove(deps, guard.body);
      if (action === "update") return await update(deps, guard.body);
      return await create(deps, guard.body);
    });
  };
}

async function create(
  deps: CarpoolWriteHandlerDeps,
  body: Record<string, unknown>,
): Promise<Response> {
  const name = readString(body, "name");
  if (name === null) {
    return errorResponse(400, "A carpool needs a name.");
  }
  if (nameTooLong(name)) {
    return errorResponse(
      400,
      `That name is too long (limit ${MAX_NAME_LENGTH} characters).`,
    );
  }

  const existing = await deps.store.listCarpools();
  const alreadyExists = existing.some(
    (carpool) => carpool.name.toLowerCase() === name.toLowerCase(),
  );
  if (alreadyExists) {
    return errorResponse(
      409,
      `A carpool named "${name}" already exists. Edit the existing one instead of adding a second.`,
    );
  }

  const carpool = await deps.store.createCarpool({
    name,
    aliases: readAliases(body),
  });

  const memberIds = readMemberIds(body);
  const members =
    memberIds && memberIds.length > 0
      ? await deps.store.setCarpoolMembers(carpool.id, memberIds)
      : [];

  return jsonResponse({ carpool, members, created: true });
}

async function update(
  deps: CarpoolWriteHandlerDeps,
  body: Record<string, unknown>,
): Promise<Response> {
  const carpoolId = readString(body, "carpoolId");
  if (carpoolId === null) {
    return errorResponse(400, "No carpool was chosen to edit.");
  }

  const patch: { name?: string; aliases?: string[] } = {};
  if ("name" in body) {
    const name = readString(body, "name");
    if (name === null) {
      return errorResponse(400, "A carpool's name cannot be blank.");
    }
    if (nameTooLong(name)) {
      return errorResponse(
        400,
        `That name is too long (limit ${MAX_NAME_LENGTH} characters).`,
      );
    }
    const existing = await deps.store.listCarpools();
    const collidesWithAnother = existing.some(
      (carpool) =>
        carpool.id !== carpoolId &&
        carpool.name.toLowerCase() === name.toLowerCase(),
    );
    if (collidesWithAnother) {
      return errorResponse(
        409,
        `A carpool named "${name}" already exists.`,
      );
    }
    patch.name = name;
  }
  if ("aliases" in body) patch.aliases = readAliases(body);

  const carpool = await deps.store.updateCarpool(carpoolId, patch);
  if (carpool === null) {
    return errorResponse(404, "That carpool no longer exists.");
  }

  // `memberIds`, when sent, is the WHOLE desired membership, not an addition
  // to it -- so a student currently linked to this carpool but missing from
  // the new list has to be explicitly unlinked, not merely left alone.
  const memberIds = readMemberIds(body);
  let members: Awaited<ReturnType<RosterStore["setCarpoolMembers"]>> = [];
  if (memberIds !== null) {
    const roster = await deps.store.list({});
    const currentMemberIds = roster
      .filter((student) => student.carpool_id === carpoolId)
      .map((student) => student.id);
    const desired = new Set(memberIds);
    const toUnlink = currentMemberIds.filter((id) => !desired.has(id));

    members = await deps.store.setCarpoolMembers(carpoolId, memberIds);
    if (toUnlink.length > 0) {
      await deps.store.setCarpoolMembers(null, toUnlink);
    }
  }

  return jsonResponse({ carpool, members, created: false });
}

async function remove(
  deps: CarpoolWriteHandlerDeps,
  body: Record<string, unknown>,
): Promise<Response> {
  const carpoolId = readString(body, "carpoolId");
  if (carpoolId === null) {
    return errorResponse(400, "No carpool was chosen to remove.");
  }

  const removed = await deps.store.removeCarpool(carpoolId);
  if (!removed) {
    return errorResponse(404, "That carpool no longer exists.");
  }
  return jsonResponse({ deleted: true });
}
