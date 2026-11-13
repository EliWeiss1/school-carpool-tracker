/**
 * School identity helpers shared by the guard, the stores and the handlers.
 */

/**
 * The school that existed before schools did. The expand migration creates it
 * with this fixed id and files every pre-existing row under it.
 *
 * It is named here for exactly one caller: the guard's legacy staff-PIN branch,
 * which has no token to read a school from. That branch, and this constant, go
 * away at cutover.
 */
export const LEGACY_SCHOOL_ID = "00000000-0000-4000-8000-000000000001";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a canonical UUID string. Anything else never reaches a query. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
