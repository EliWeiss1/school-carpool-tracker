/**
 * POST /school-write — a school's own settings, device codes and devices.
 *
 * One endpoint, several actions (like /classes-write), selected by `action`:
 *
 * - `create` needs a confirmed office account and *no school yet*, so it uses
 *   `authenticateRequest`.
 * - Every other action goes through `guardSessionRequest(..., "office")` and
 *   acts only on the `schoolId` the guard returns. No handler below reads a
 *   school id from the body: the body is what the caller claims, the guard's
 *   answer is what was checked.
 *
 * The staff PIN has no way in here: neither guard accepts one.
 */

import { isValidDeviceCode, normalizeDeviceCode } from "../device-code.ts";
import {
  errorResponse,
  jsonResponse,
  preflight,
  readJsonBody,
  readString,
  withStoreErrors,
} from "../http.ts";
import {
  readResetDays,
  readResetHour,
  readSchoolName,
  readSlug,
  readTimeZone,
} from "../school-input.ts";
import type {
  CodeTarget,
  SchoolStore,
  SettingsPatch,
} from "../school-ports.ts";
import {
  type AuthDeps,
  authenticateRequest,
  guardSessionRequest,
} from "./guard.ts";

export interface SchoolWriteHandlerDeps extends AuthDeps {
  schools: SchoolStore;
}

const OFFICE_ACTIONS = [
  "update-settings",
  "get-codes",
  "set-code",
  "list-devices",
  "disconnect-device",
] as const;
type OfficeAction = (typeof OFFICE_ACTIONS)[number];

function isOfficeAction(value: unknown): value is OfficeAction {
  return (
    typeof value === "string" &&
    (OFFICE_ACTIONS as readonly string[]).includes(value)
  );
}

const CODE_TARGETS: readonly CodeTarget[] = ["announce", "display", "both"];

export function createSchoolWriteHandler(deps: SchoolWriteHandlerDeps) {
  return async function handle(request: Request): Promise<Response> {
    const options = preflight(request);
    if (options) return options;

    // The guards read the body themselves, so the action is read from a clone to
    // choose which guard runs. Nothing here trusts it before authentication.
    const peeked = await readJsonBody(request.clone());

    if (peeked.action === "create") {
      return await createSchool(request, deps);
    }

    const guard = await guardSessionRequest(request, deps, "office");
    if (!guard.ok) return guard.response;

    if (!isOfficeAction(guard.body.action)) {
      return errorResponse(
        400,
        "That action is not available. Reload the page and try again.",
      );
    }

    const { schoolId, body } = guard;
    return await withStoreErrors(async () => {
      switch (guard.body.action as OfficeAction) {
        case "update-settings":
          return await updateSettings(deps.schools, schoolId, body);
        case "get-codes":
          return jsonResponse(await deps.schools.getCodes(schoolId));
        case "set-code":
          return await setCode(deps.schools, schoolId, body);
        case "list-devices":
          return jsonResponse({
            devices: await deps.schools.listDevices(schoolId),
          });
        case "disconnect-device":
          return await disconnectDevice(deps.schools, schoolId, body);
      }
    });
  };
}

async function createSchool(
  request: Request,
  deps: SchoolWriteHandlerDeps,
): Promise<Response> {
  const auth = await authenticateRequest(request, deps);
  if (!auth.ok) return auth.response;

  if (auth.user.isAnonymous) {
    return errorResponse(
      403,
      "Sign in with an office account to create a school.",
    );
  }
  if (!auth.user.emailConfirmed) {
    return errorResponse(
      403,
      "Confirm your email address first. Check your inbox for the link.",
    );
  }

  const name = readSchoolName(auth.body.name);
  if (!name.ok) return errorResponse(400, name.error);
  const slug = readSlug(auth.body.slug);
  if (!slug.ok) return errorResponse(400, slug.error);
  const timezone = readTimeZone(auth.body.timezone);
  if (!timezone.ok) return errorResponse(400, timezone.error);

  return await withStoreErrors(async () => {
    const outcome = await deps.schools.createSchool({
      userId: auth.user.userId,
      name: name.value,
      slug: slug.value,
      timezone: timezone.value,
    });
    if (outcome.status === "slug-taken") {
      return errorResponse(409, "That web address is taken. Try another.");
    }
    return jsonResponse({
      school: outcome.school,
      created: outcome.status === "created",
    });
  });
}

async function updateSettings(
  schools: SchoolStore,
  schoolId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const patch: SettingsPatch = {};

  if (body.name !== undefined) {
    const name = readSchoolName(body.name);
    if (!name.ok) return errorResponse(400, name.error);
    patch.name = name.value;
  }
  if (body.timezone !== undefined) {
    const timezone = readTimeZone(body.timezone);
    if (!timezone.ok) return errorResponse(400, timezone.error);
    patch.timezone = timezone.value;
  }
  if (body.resetHour !== undefined) {
    const hour = readResetHour(body.resetHour);
    if (!hour.ok) return errorResponse(400, hour.error);
    patch.resetHour = hour.value;
  }
  if (body.resetDays !== undefined) {
    const days = readResetDays(body.resetDays);
    if (!days.ok) return errorResponse(400, days.error);
    patch.resetDays = days.value;
  }

  if (Object.keys(patch).length === 0) {
    return errorResponse(400, "Choose at least one setting to change.");
  }

  const school = await schools.updateSettings(schoolId, patch);
  if (!school) {
    return errorResponse(403, "This account is not connected to this school.");
  }
  return jsonResponse({ school });
}

async function setCode(
  schools: SchoolStore,
  schoolId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const which = body.which;
  if (
    typeof which !== "string" ||
    !(CODE_TARGETS as readonly string[]).includes(which)
  ) {
    return errorResponse(
      400,
      "Choose whether this is the announce code, the display code, or both.",
    );
  }

  // null clears the code, which stops anything pairing with it.
  let code: string | null = null;
  if (body.code !== null) {
    if (!isValidDeviceCode(body.code)) {
      return errorResponse(
        400,
        "Use 6 to 20 letters and numbers for the code.",
      );
    }
    code = normalizeDeviceCode(body.code as string);
  }

  // Only a literal true disconnects: a stray truthy string must not sign
  // every phone out.
  const result = await schools.setCode(
    schoolId,
    which as CodeTarget,
    code,
    body.disconnectDevices === true,
  );

  // The rows are already gone, so the devices are disconnected whether or not
  // their sessions are deleted (a session with no row has no access). A failure
  // here is therefore not the office's problem to see.
  if (result.disconnectedUserIds.length > 0) {
    try {
      await schools.deleteDeviceUsers(result.disconnectedUserIds);
    } catch (error: unknown) {
      console.error("could not delete disconnected device sessions", error);
    }
  }

  return jsonResponse({
    announceCode: result.announceCode,
    displayCode: result.displayCode,
    disconnected: result.disconnectedUserIds.length,
  });
}

async function disconnectDevice(
  schools: SchoolStore,
  schoolId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const deviceRowId = readString(body, "deviceRowId");
  if (deviceRowId === null) {
    return errorResponse(400, "No device was chosen to disconnect.");
  }
  // The store matches the row to this school, so another school's row is null.
  const userId = await schools.removeDevice(schoolId, deviceRowId);
  if (userId === null) return jsonResponse({ disconnected: false });

  // The row is what gave the device access, and it is gone. Ending the session
  // as well is tidying up: if it fails, the device is still disconnected.
  try {
    await schools.deleteDeviceUsers([userId]);
  } catch (error: unknown) {
    console.error("could not delete a disconnected device session", error);
  }
  return jsonResponse({ disconnected: true });
}
