import type { Student } from "@/types/db";

/**
 * The board's own reducer for `students` Postgres Changes payloads. This is
 * where the bugs in a realtime UI actually live, so it is a pure,
 * dependency-free module (no supabase-js types, no browser APIs, no React)
 * that a component wires up and that a test can drive with synthetic data and
 * no network at all.
 *
 * Two correctness rules everything here exists to enforce:
 *
 * 1. `students` is published with FULL replica identity (see
 *    `supabase/migrations/20260902090000_init_carpool_board.sql`), so an
 *    UPDATE payload's `old` is a complete previous row, not a primary-key-only
 *    stub. That is what would let a caller tell a genuine waiting -> arrived
 *    transition from an unrelated edit (a rename, a grade change) using the
 *    wire payload alone -- but `reconcile` does not actually need `old` for
 *    this, and deliberately does not trust it. See the note on `old` below.
 * 2. `updated_at` is a transaction timestamp. A payload that is not strictly
 *    newer than the row already held for that student is discarded outright,
 *    so an out-of-order delivery (a real risk over a websocket reconnecting
 *    mid-afternoon) can never resurrect a stale status.
 */

export type DisplayRoster = Record<string, Student>;

export type StudentChangePayload =
  | { eventType: "INSERT"; new: Student; old: Student | null }
  | { eventType: "UPDATE"; new: Student; old: Student | null }
  | { eventType: "DELETE"; new: null; old: Student };

export interface ReconcileResult {
  roster: DisplayRoster;
  /**
   * Student ids that made a genuine waiting -> arrived transition on this
   * call. Empty for an insert, a delete, an undo, a rename, or anything
   * discarded as stale -- that emptiness is what a caller uses to decide
   * whether to flash a tile and coalesce a chime.
   */
  arrivals: string[];
}

function parsedTime(iso: string): number {
  return Date.parse(iso);
}

/** Strictly newer than the row already held, or nothing was held yet. */
function isFresh(incoming: Student, existing: Student | undefined): boolean {
  if (!existing) return true;
  return parsedTime(incoming.updated_at) > parsedTime(existing.updated_at);
}

/**
 * Turns one realtime payload into the board's next roster.
 *
 * The transition check deliberately compares the incoming row against the
 * roster this function already holds (`existing`), not against the payload's
 * own `old`. Once a payload has passed the freshness check, `existing` *is*
 * the most recently accepted state for that student, which makes it a more
 * reliable "before" than a value that arrived over the wire and could in
 * principle describe a baseline this client has already moved past. It also
 * means a payload missing `old` (nothing depends on FULL replica identity
 * here beyond what the migration already guarantees for the table) still
 * reconciles correctly.
 */
export function reconcile(
  roster: DisplayRoster,
  payload: StudentChangePayload,
): ReconcileResult {
  if (payload.eventType === "DELETE") {
    const id = payload.old.id;
    if (!(id in roster)) return { roster, arrivals: [] };
    const next = { ...roster };
    delete next[id];
    return { roster: next, arrivals: [] };
  }

  const incoming = payload.new;
  const existing = roster[incoming.id];

  if (!isFresh(incoming, existing)) {
    // Stale or redelivered -- including an exact-timestamp redelivery, which
    // must not double-flash or double-chime.
    return { roster, arrivals: [] };
  }

  const arrivals =
    existing !== undefined &&
    existing.status === "waiting" &&
    incoming.status === "arrived"
      ? [incoming.id]
      : [];

  return {
    roster: { ...roster, [incoming.id]: incoming },
    arrivals,
  };
}

/**
 * Merges a full-table fetch (the initial load, or a reconnect's refetch) into
 * the roster already held. Has no `arrivals` in its return type at all --
 * structurally impossible to flash or chime from a snapshot, which matters
 * because plenty of rows in it are already 'arrived' from earlier in the day.
 *
 * Never removes a locally-held student who is simply absent from `rows`: only
 * a DELETE payload does that. A student inserted by realtime after the
 * snapshot query ran but before its response reached the browser must survive
 * this merge, not be treated as evidence the row does not exist.
 *
 * The one race this leaves open, on record rather than silently accepted: a
 * DELETE that lands in that same narrow window -- after the snapshot query ran,
 * before its response arrived -- can be "undone" by the snapshot re-adding the
 * row, until the next event for that student. Tracking tombstones to close it
 * is not worth the complexity for a single-building board where roster edits
 * happen in /admin, not in the few hundred milliseconds a fetch is in flight.
 */
export function applySnapshot(
  roster: DisplayRoster,
  rows: readonly Student[],
): DisplayRoster {
  const next = { ...roster };
  for (const row of rows) {
    const existing = next[row.id];
    if (!existing || parsedTime(row.updated_at) >= parsedTime(existing.updated_at)) {
      next[row.id] = row;
    }
  }
  return next;
}
