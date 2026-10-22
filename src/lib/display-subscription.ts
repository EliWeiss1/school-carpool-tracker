import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

import type { StudentChangePayload } from "@/lib/realtime-reconcile";
import type { Student } from "@/types/db";

/**
 * The realtime wiring for `/display`, kept out of the component so the one
 * rule that is easy to get wrong -- "a class-membership change refetches and
 * never counts as an arrival" -- is unit-tested with a fake client.
 *
 * Two tables are watched:
 *
 * - `students`: row changes go to `onStudentChange`, which the board reduces
 *   with `reconcile` (and so may flash and chime).
 * - `student_classes`: membership changes carry no status, so they can never
 *   be an arrival. Each one just schedules a snapshot refetch, debounced
 *   because a bulk edit in /admin lands as a burst of row events and one
 *   refetch after the burst is all the board needs.
 */

/** Quiet period after the last membership event before refetching. */
export const MEMBERSHIP_REFETCH_DEBOUNCE_MS = 300;

/** The slice of a supabase-js realtime channel this module uses. */
interface ChannelLike {
  on(
    type: "postgres_changes",
    filter: { event: "*"; schema: "public"; table: string },
    listener: (payload: never) => void,
  ): ChannelLike;
  subscribe(callback: (status: string) => void): ChannelLike;
}

/** The slice of the supabase-js client this module uses (also what tests fake). */
export interface BoardClient {
  channel(name: string): ChannelLike;
  removeChannel(channel: never): Promise<unknown>;
}

export interface BoardHandlers {
  /** A `students` row changed; reduce it into the roster. */
  onStudentChange(payload: StudentChangePayload): void;
  /** Fetch the full roster: on every (re)connect and after membership edits. */
  onSnapshotNeeded(): void;
  /** The channel errored or timed out. */
  onConnectionError(): void;
}

/**
 * `students` carries FULL replica identity, so a genuine payload always has a
 * complete row in `old` for UPDATE/DELETE -- but the wire *type* only
 * promises `Partial<T>`, because supabase-js has no way to know a given
 * table's replica identity. This is the one place that gap is bridged, with a
 * runtime check rather than a blind cast.
 */
function fullRowOrNull(
  row: Partial<Student> | Record<string, never>,
): Student | null {
  return "id" in row && "status" in row && "updated_at" in row
    ? (row as Student)
    : null;
}

export function toChangePayload(
  payload: RealtimePostgresChangesPayload<Student>,
): StudentChangePayload | null {
  if (payload.eventType === "DELETE") {
    const old = fullRowOrNull(payload.old);
    // Cannot happen given REPLICA IDENTITY FULL on students, but a payload
    // with no identifiable row is not something this board can reconcile --
    // silently dropping one malformed delete beats crashing the board.
    if (!old) return null;
    return { eventType: "DELETE", new: null, old };
  }

  return {
    eventType: payload.eventType,
    new: payload.new,
    old: fullRowOrNull(payload.old),
  };
}

/**
 * Opens the board's channel. Subscribe first, then fetch: the channel is open
 * before any snapshot runs, so a change in the gap is reconciled rather than
 * lost. Every SUBSCRIBED (first connect and each reconnect) fetches again,
 * which is what makes a reconnect refetch current state instead of waiting for
 * the next event. Returns a disconnect function that also cancels a pending
 * membership refetch.
 */
export function connectBoard(
  client: BoardClient,
  handlers: BoardHandlers,
): () => void {
  let closed = false;
  let refetchTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleMembershipRefetch() {
    if (refetchTimer) clearTimeout(refetchTimer);
    refetchTimer = setTimeout(() => {
      refetchTimer = null;
      if (!closed) handlers.onSnapshotNeeded();
    }, MEMBERSHIP_REFETCH_DEBOUNCE_MS);
  }

  const channel = client
    .channel("display-students")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "students" },
      (payload: RealtimePostgresChangesPayload<Student>) => {
        if (closed) return;
        const change = toChangePayload(payload);
        if (change) handlers.onStudentChange(change);
      },
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "student_classes" },
      () => {
        if (!closed) scheduleMembershipRefetch();
      },
    )
    .subscribe((status) => {
      if (closed) return;
      if (status === "SUBSCRIBED") {
        handlers.onSnapshotNeeded();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        handlers.onConnectionError();
      }
    });

  return () => {
    closed = true;
    if (refetchTimer) clearTimeout(refetchTimer);
    refetchTimer = null;
    void client.removeChannel(channel as never);
  };
}
